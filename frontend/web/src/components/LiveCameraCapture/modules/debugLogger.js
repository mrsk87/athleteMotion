/**
 * Gestor de Diagnóstico, Interceção de Erros e Logs no Ecrã (DebugLogger).
 *
 * Responsabilidade:
 * - Capturar erros globais do browser (window.onerror e unhandledrejection).
 * - Manter buffer de diagnóstico em memória para o painel flutuante de suporte.
 * - Copiar relatório de logs para a área de transferência.
 */

export class DebugLogger {
  constructor({ onNewLog }) {
    this.logs = [];
    this.onNewLog = onNewLog;
    this.errorHandler = null;
    this.rejectionHandler = null;
  }

  setup() {
    this.errorHandler = (event) => {
      const msg = `${event.message} (${event.filename || 'script'}:${event.lineno || 0})`;
      this.addLog('error', msg);
    };

    this.rejectionHandler = (event) => {
      const msg = event.reason?.stack || event.reason?.message || String(event.reason);
      this.addLog('error', `Promise Rejeitada: ${msg}`);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('error', this.errorHandler);
      window.addEventListener('unhandledrejection', this.rejectionHandler);
    }

    this.addLog('info', 'Athlete Motion ativo. A monitorizar pipeline de câmara e IA.');
  }

  teardown() {
    if (typeof window !== 'undefined') {
      if (this.errorHandler) window.removeEventListener('error', this.errorHandler);
      if (this.rejectionHandler) window.removeEventListener('unhandledrejection', this.rejectionHandler);
    }
  }

  addLog(type, message) {
    const now = new Date();
    const timeStr = `${now.toLocaleTimeString()}.${String(now.getMilliseconds()).padStart(3, '0')}`;
    const entry = `[${timeStr}] [${type.toUpperCase()}] ${message}`;

    this.logs.push({ time: timeStr, type, message: entry });
    if (this.logs.length > 50) {
      this.logs.shift();
    }
    if (this.onNewLog) this.onNewLog(this.logs);
  }

  copyLogsToClipboard() {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      const fullText = this.logs.map((l) => l.message).join('\n');
      return navigator.clipboard.writeText(fullText);
    }
    return Promise.reject(new Error('Área de transferência indisponível.'));
  }
}
