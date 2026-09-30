const status = document.querySelector('#connection-status');
const button = document.querySelector('#check-connection');
async function checkConnection() {
  button.disabled = true;
  status.textContent = 'Checking the test database…';
  status.dataset.state = 'checking';
  try {
    const response = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
    const health = await response.json();
    if (response.ok && health.environment === 'test' && health.database === 'connected' && health.core_tables_ready) {
      status.textContent = 'Connected. All five starting tables are present.';
      status.dataset.state = 'ready';
    } else if (health.database === 'connected') {
      status.textContent = 'Connected, but some starting tables still need to be created.';
      status.dataset.state = 'pending';
    } else {
      status.textContent = 'Connection not yet confirmed. The database binding may still need setup.';
      status.dataset.state = 'pending';
    }
  } catch {
    status.textContent = 'Could not check the connection. Check your internet connection and try again.';
    status.dataset.state = 'pending';
  } finally {
    button.disabled = false;
  }
}
button.addEventListener('click', checkConnection);
checkConnection();
