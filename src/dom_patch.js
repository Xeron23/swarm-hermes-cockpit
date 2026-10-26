// Reconcile existing nodes so telemetry does not destroy focus or animations.
const key = node => node.nodeType === 1 ? node.id || node.getAttribute('data-key') : null;
const compatible = (a, b) => a && a.nodeType === b.nodeType && a.nodeName === b.nodeName && key(a) === key(b);
function syncNode(current, next) {
  if (current.nodeType !== 1) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return;
  }
  const control = /^(INPUT|TEXTAREA|SELECT)$/.test(current.nodeName);
  const editing = control && (current.ownerDocument.activeElement === current || current.dataset.composing === 'true');
  for (const attribute of [...current.attributes]) {
    if (attribute.name === 'data-composing' || editing && attribute.name === 'value') continue;
    if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
  }
  for (const attribute of [...next.attributes]) {
    if (editing && attribute.name === 'value') continue;
    if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
  }
  if (current.nodeName === 'TEXTAREA') {
    if (!editing && current.value !== next.value) current.value = next.value;
    return;
  }
  syncChildren(current, next);
  if (control && !editing && current.value !== next.value) current.value = next.value;
}
export function syncChildren(current, next) {
  const keyed = new Map([...current.childNodes].filter(node => key(node)).map(node => [key(node), node]));
  let cursor = current.firstChild;
  for (const incoming of [...next.childNodes]) {
    let node = key(incoming) ? keyed.get(key(incoming)) : cursor;
    if (!compatible(node, incoming)) node = incoming.cloneNode(true);
    if (node !== cursor) current.insertBefore(node, cursor);
    syncNode(node, incoming);
    cursor = node.nextSibling;
  }
  while (cursor) { const unused = cursor; cursor = cursor.nextSibling; unused.remove(); }
}
export function patchMarkup(root, markup) {
  if (root.__hermesMarkup === markup) return false;
  const template = root.ownerDocument.createElement('template');
  template.innerHTML = markup;
  syncChildren(root, template.content);
  root.__hermesMarkup = markup;
  return true;
}
