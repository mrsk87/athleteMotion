// Polyfills and test setup
import 'fake-indexeddb/auto';

// Mock WebCrypto subtle if needed
if (typeof window !== 'undefined' && !window.crypto) {
  window.crypto = {};
}
