package io.github.xeron.hermesupdates

import androidx.core.content.FileProvider

// A separate component prevents merging with the host app's FileProvider.
class HermesUpdateFileProvider : FileProvider()
