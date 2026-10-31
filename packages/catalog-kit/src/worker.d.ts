// Vite turns "?worker&inline" imports into a Worker constructor bundled into the page (no separate file: the TV
// loads the app over file://).
declare module "*?worker&inline" {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}
