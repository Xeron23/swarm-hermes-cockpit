use std::{error::Error, io, time::Duration};

use reqwest::{header, redirect::Policy, Client, Method, Url};
use serde::{Deserialize, Serialize};

const SERVER: &str = "http://192.168.1.4:3450";

pub(crate) struct BackendHttp {
    client: Client,
    origin: Url,
}

#[derive(Deserialize)]
pub(crate) struct BackendRequest {
    url: String,
    method: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct BackendError {
    code: &'static str,
    message: &'static str,
}

#[derive(Serialize)]
pub(crate) struct BackendResponse {
    status: u16,
    body: String,
}

impl BackendHttp {
    pub(crate) fn new() -> Result<Self, reqwest::Error> {
        Ok(Self {
            // This client only reaches the configured VM. LAN and Tailscale
            // subnet traffic must follow OS routes, not an inherited HTTP proxy.
            client: Client::builder()
                .no_proxy()
                .redirect(Policy::none())
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(20))
                .build()?,
            origin: Url::parse(SERVER).expect("static backend origin"),
        })
    }

    async fn execute(&self, request: BackendRequest) -> Result<BackendResponse, BackendError> {
        let denied = || BackendError {
            code: "NATIVE_SCOPE_DENIED",
            message: "Native HTTP hanya mengizinkan API pada VM yang dikonfigurasi.",
        };
        let url = Url::parse(&request.url).map_err(|_| denied())?;
        if url.origin() != self.origin.origin()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
            || !(matches!(url.path(), "/health/live" | "/health/ready")
                || url.path().starts_with("/api/v1/"))
        {
            return Err(denied());
        }
        let method = match request.method.as_str() {
            "GET" => Method::GET,
            "POST" => Method::POST,
            _ => return Err(denied()),
        };
        let mut builder = self.client.request(method, url);
        for (name, value) in request.headers {
            let name = header::HeaderName::from_bytes(name.as_bytes()).map_err(|_| denied())?;
            if name != header::ACCEPT
                && name != header::CONTENT_TYPE
                && name != header::AUTHORIZATION
            {
                return Err(denied());
            }
            builder = builder.header(name, value);
        }
        if let Some(body) = request.body {
            builder = builder.body(body);
        }
        let response = builder.send().await.map_err(network_error)?;
        let status = response.status().as_u16();
        let body = response.text().await.map_err(network_error)?;
        Ok(BackendResponse { status, body })
    }
}

fn network_error(error: reqwest::Error) -> BackendError {
    if error.is_timeout() {
        return BackendError {
            code: "TIMEOUT",
            message: "Batas waktu HTTP native ke VM habis.",
        };
    }
    let mut source: Option<&(dyn Error + 'static)> = Some(&error);
    while let Some(cause) = source {
        if let Some(cause) = cause.downcast_ref::<io::Error>() {
            let failure = match cause.kind() {
                io::ErrorKind::ConnectionRefused => Some((
                    "CONNECTION_REFUSED",
                    "Port API VM menolak koneksi aplikasi.",
                )),
                io::ErrorKind::PermissionDenied => Some((
                    "NETWORK_ACCESS_DENIED",
                    "OS menolak akses jaringan aplikasi ke VM.",
                )),
                io::ErrorKind::NetworkUnreachable | io::ErrorKind::HostUnreachable => {
                    Some(("ROUTE_UNREACHABLE", "Rute OS menuju VM tidak tersedia."))
                }
                io::ErrorKind::TimedOut => {
                    Some(("TIMEOUT", "Batas waktu HTTP native ke VM habis."))
                }
                _ => None,
            };
            if let Some((code, message)) = failure {
                return BackendError { code, message };
            }
        }
        source = cause.source();
    }
    // Never expose raw error chains: they may include auth URLs or headers.
    BackendError {
        code: "NETWORK_ERROR",
        message: "HTTP native belum dapat menyelesaikan koneksi langsung ke VM.",
    }
}

#[tauri::command]
pub(crate) async fn backend_request(
    state: tauri::State<'_, BackendHttp>,
    request: BackendRequest,
) -> Result<BackendResponse, BackendError> {
    state.execute(request).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::{Arc, Mutex},
        thread,
    };

    fn fixture(
        responses: Vec<String>,
    ) -> (String, Arc<Mutex<Vec<String>>>, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let output = requests.clone();
        let server = thread::spawn(move || {
            listener.set_nonblocking(true).unwrap();
            let deadline = std::time::Instant::now() + Duration::from_secs(3);
            for response in responses {
                let mut socket = loop {
                    if let Ok((socket, _)) = listener.accept() {
                        break socket;
                    }
                    assert!(
                        std::time::Instant::now() < deadline,
                        "Fixture request timed out"
                    );
                    thread::sleep(Duration::from_millis(5));
                };
                socket
                    .set_read_timeout(Some(Duration::from_secs(1)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0; 2048];
                loop {
                    let size = socket.read(&mut buffer).unwrap();
                    assert!(size > 0);
                    bytes.extend_from_slice(&buffer[..size]);
                    if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                        let size: usize = headers
                            .lines()
                            .find_map(|line| line.strip_prefix("content-length: "))
                            .unwrap_or("0")
                            .parse()
                            .unwrap();
                        if bytes.len() >= end + 4 + size {
                            break;
                        }
                    }
                }
                output
                    .lock()
                    .unwrap()
                    .push(String::from_utf8(bytes).unwrap());
                socket.write_all(response.as_bytes()).unwrap();
            }
        });
        (origin, requests, server)
    }

    fn response(body: &str) -> String {
        format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
    }

    fn client(origin: &str) -> BackendHttp {
        let mut client = BackendHttp::new().unwrap();
        client.origin = Url::parse(origin).unwrap();
        client
    }

    fn request(origin: &str, path: &str) -> BackendRequest {
        BackendRequest {
            url: format!("{origin}{path}"),
            method: "GET".into(),
            headers: vec![],
            body: None,
        }
    }

    #[test]
    fn real_sockets_preserve_post_body_auth_and_http_errors_without_browser_origin_or_cookies() {
        let (origin, requests, server) = fixture(vec![
            response("{\"status\":\"ok\"}"),
            response("{\"paired\":true}"),
            "HTTP/1.1 403 Forbidden\r\nContent-Length: 6\r\nConnection: close\r\n\r\ndenied".into(),
        ]);
        let client = client(&origin);
        tauri::async_runtime::block_on(async {
            assert_eq!(
                client
                    .execute(request(&origin, "/health/ready"))
                    .await
                    .unwrap()
                    .body,
                "{\"status\":\"ok\"}"
            );
            let mut pair = request(&origin, "/api/v1/auth/pair");
            pair.method = "POST".into();
            pair.body = Some("{\"pairing_code\":\"fixture-only\"}".into());
            pair.headers
                .push(("Content-Type".into(), "application/json".into()));
            client.execute(pair).await.unwrap();
            let mut bootstrap = request(&origin, "/api/v1/bootstrap");
            bootstrap
                .headers
                .push(("Authorization".into(), "Bearer fixture-access".into()));
            let denied = client.execute(bootstrap).await.unwrap();
            assert_eq!(denied.status, 403);
            assert_eq!(denied.body, "denied");
        });
        server.join().unwrap();
        let requests = requests.lock().unwrap();
        assert!(requests[1].starts_with("POST /api/v1/auth/pair "));
        assert!(requests[1].contains("fixture-only"));
        assert!(!requests[1].to_lowercase().contains("authorization:"));
        assert!(requests[2]
            .to_lowercase()
            .contains("authorization: bearer fixture-access"));
        for value in requests.iter() {
            assert!(!value.to_lowercase().contains("\r\norigin:"));
            assert!(!value.to_lowercase().contains("\r\ncookie:"));
        }
    }

    #[test]
    fn origin_path_method_and_headers_are_checked_before_network_access() {
        let client = BackendHttp::new().unwrap();
        tauri::async_runtime::block_on(async {
            for url in [
                "https://192.168.1.4:3450/api/v1/nodes",
                "http://192.168.1.4:8795/api/v1/nodes",
                "http://100.114.42.71:3450/api/v1/nodes",
                "http://192.168.1.4:3450/api/v1/../../docs",
                "http://user:secret@192.168.1.4:3450/api/v1/nodes",
                "http://192.168.1.4:3450/api/v1/nodes#fragment",
            ] {
                let mut value = request(SERVER, "/api/v1/nodes");
                value.url = url.into();
                assert_eq!(
                    client.execute(value).await.err().unwrap().code,
                    "NATIVE_SCOPE_DENIED"
                );
            }
            let mut value = request(SERVER, "/api/v1/nodes");
            value.method = "DELETE".into();
            assert_eq!(
                client.execute(value).await.err().unwrap().code,
                "NATIVE_SCOPE_DENIED"
            );
            let mut value = request(SERVER, "/api/v1/nodes");
            value.headers.push(("Host".into(), "other.invalid".into()));
            assert_eq!(
                client.execute(value).await.err().unwrap().code,
                "NATIVE_SCOPE_DENIED"
            );
        });
    }

    #[test]
    fn real_connection_refusal_has_a_safe_structured_code() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        let error = tauri::async_runtime::block_on(
            client(&origin).execute(request(&origin, "/health/ready")),
        )
        .err()
        .unwrap();
        assert_eq!(error.code, "CONNECTION_REFUSED");
        assert!(!error.message.contains(&origin));
    }

    #[test]
    fn redirects_never_forward_credentials_to_another_origin() {
        let (origin, _, server) = fixture(vec!["HTTP/1.1 307 Temporary Redirect\r\nLocation: http://127.0.0.1:1/leak\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into()]);
        let mut value = request(&origin, "/api/v1/bootstrap");
        value
            .headers
            .push(("Authorization".into(), "Bearer fixture-access".into()));
        let result = tauri::async_runtime::block_on(client(&origin).execute(value)).unwrap();
        assert_eq!(result.status, 307);
        server.join().unwrap();
    }

    #[test]
    fn real_tauri_ipc_calls_the_http_handler_only_from_the_permitted_window() {
        use serde_json::json;
        use tauri::{
            ipc::{CallbackFn, InvokeBody},
            test::{get_ipc_response, mock_builder, INVOKE_KEY},
            webview::InvokeRequest,
        };
        let (origin, requests, server) = fixture(vec![response("{\"status\":\"ok\"}")]);
        let app = mock_builder()
            .manage(client(&origin))
            .invoke_handler(tauri::generate_handler![super::backend_request])
            .build(tauri::generate_context!())
            .unwrap();
        let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let denied = tauri::WebviewWindowBuilder::new(&app, "other", Default::default())
            .build()
            .unwrap();
        let invoke = || InvokeRequest {
            cmd: "backend_request".into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: if cfg!(windows) {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            }
            .parse()
            .unwrap(),
            body: InvokeBody::Json(
                json!({"request":{"url":format!("{origin}/health/ready"),"method":"GET","headers":[],"body":null}}),
            ),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        };
        assert!(get_ipc_response(&denied, invoke()).is_err());
        let result = get_ipc_response(&main, invoke())
            .unwrap()
            .deserialize::<serde_json::Value>()
            .unwrap();
        assert_eq!(result["status"], 200);
        assert_eq!(result["body"], "{\"status\":\"ok\"}");
        server.join().unwrap();
        assert_eq!(requests.lock().unwrap().len(), 1);
    }
}
