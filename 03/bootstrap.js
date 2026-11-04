const status = document.querySelector('#status');
status.hidden = false; status.textContent = 'Preparing the sculpture…';
try {
  const { startExperiment } = await import('./main.js');
  await startExperiment();
} catch (error) {
  status.hidden = false; status.textContent = `Stopped: ${error.message}`;
  console.error(error);
}
