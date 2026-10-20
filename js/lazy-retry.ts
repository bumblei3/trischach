/**
 * Wiederholter Dynamic-Import für die lazy geladenen Modul-Chunks.
 *
 * Hintergrund: Ein `import()` kann transient scheitern — im Vite-Dev-Server
 * sporadisch unter Last ("Failed to fetch dynamically imported module"), in
 * Produktion z. B. bei einem abgebrochenen Chunk-Request. Ein einmaliger
 * Retry nach kurzer Pause deckt das ab; erst danach wird der Fehler
 * weitergereicht, damit der Aufrufer (und die Tests) ihn noch sieht.
 *
 * Bewusst wird derselbe Specifier erneut importiert: ein reiner Netzwerkfehler
 * wird vom Browser nicht gecacht, ein Wiederholungsversuch lädt also wirklich
 * neu.
 */
const RETRY_DELAY_MS = 300;

export async function retryImport<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (firstError) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    try {
      return await load();
    } catch {
      // Der erste Fehler beschreibt die Ursache besser als der zweite.
      console.warn("Lazy-Modul konnte auch beim zweiten Versuch nicht laden");
      throw firstError;
    }
  }
}
