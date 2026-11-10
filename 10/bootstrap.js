try {
  const { startExperiment } = await import("./main.js");
  await startExperiment();
} catch (error) {
  const status = document.querySelector("#status");
  status.hidden = false;
  status.textContent = `Unable to start: ${error.message}`;
  console.error(error);
}
