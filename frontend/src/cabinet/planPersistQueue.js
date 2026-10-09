/** Сериализует сохранения плана, чтобы автосохранение и кнопка не создали одни и те же уроки дважды. */
export function createPersistQueue() {
  let chain = Promise.resolve();
  return function enqueue(task) {
    const run = chain.then(task, task);
    chain = run.then(() => undefined, () => undefined);
    return run;
  };
}
