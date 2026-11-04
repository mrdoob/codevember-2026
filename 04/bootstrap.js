const status = document.querySelector('#status');
try {
  const { startExperiment } = await import('./main.js');
  await startExperiment();
} catch (error) {
  status.hidden = false;
  status.textContent = `Unable to start: ${error.message}`;
  console.error(error);
}
