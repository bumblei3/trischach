/**
 * Tests for the PWA bootstrap module (js/pwa.ts).
 *
 * The module runs top-level side effects (service-worker registration,
 * install-prompt listeners) on import, so each test re-imports it fresh via
 * vi.resetModules() + dynamic import against a mocked navigator/window.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

describe("pwa bootstrap", () => {
  const winListeners = new Map<string, EventListener[]>();

  function fire(type: string): void {
    for (const fn of winListeners.get(type) ?? []) {
      fn.call(window, new Event(type));
    }
  }

  beforeEach(() => {
    vi.resetModules();
    winListeners.clear();
    vi.useFakeTimers();

    // Minimal DOM: install button present (index.html ships it).
    document.body.innerHTML = '<button id="install-btn"></button>';

    vi.stubGlobal(
      "window",
      Object.assign(Object.create(window), {
        addEventListener: (type: string, fn: EventListener) => {
          const arr = winListeners.get(type) ?? [];
          arr.push(fn);
          winListeners.set(type, arr);
        },
        __fire: fire,
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mockNavigator(sw: boolean, register?: () => Promise<any>): void {
    vi.stubGlobal(
      "navigator",
      sw
        ? {
            serviceWorker: {
              register:
                register ??
                vi.fn().mockResolvedValue({ scope: "/", update: vi.fn() }),
            },
          }
        : {},
    );
  }

  test("registers the service worker when supported", async () => {
    const register = vi.fn().mockResolvedValue({ scope: "/", update: vi.fn() });
    mockNavigator(true, register);

    await import("../js/pwa.ts"); // side-effect script (no exports)
    fire("load");
    await Promise.resolve();
    await Promise.resolve();

    expect(register).toHaveBeenCalledWith("sw.js");
  });

  test("schedules hourly update checks after registration", async () => {
    const update = vi.fn();
    mockNavigator(true, vi.fn().mockResolvedValue({ scope: "/", update }));

    await import("../js/pwa.ts"); // side-effect script (no exports)
    fire("load");
    await Promise.resolve();
    await Promise.resolve();

    expect(update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(update).toHaveBeenCalledTimes(2);
  });

  test("registration failure is non-fatal (warn only)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockNavigator(true, vi.fn().mockRejectedValue(new Error("no sw")));

    await import("../js/pwa.ts"); // side-effect script (no exports)
    expect(() => fire("load")).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(warn).toHaveBeenCalled();
  });

  test("does nothing when serviceWorker is unsupported", async () => {
    mockNavigator(false);
    await import("../js/pwa.ts"); // side-effect script (no exports)
    expect(() => fire("load")).not.toThrow();
  });

  test("beforeinstallprompt reveals the install button", async () => {
    mockNavigator(false);
    await import("../js/pwa.ts"); // side-effect script (no exports)

    const btn = document.getElementById("install-btn") as HTMLButtonElement;
    expect(btn.style.display).toBe("");

    fire("beforeinstallprompt");
    expect(btn.style.display).toBe("inline-block");
  });

  test("appinstalled hides the install button again", async () => {
    mockNavigator(false);
    await import("../js/pwa.ts");

    const btn = document.getElementById("install-btn") as HTMLButtonElement;
    btn.style.display = "inline-block";

    fire("appinstalled");
    expect(btn.style.display).toBe("none");
  });

  test("install click without a deferred prompt is a no-op", async () => {
    mockNavigator(false);
    await import("../js/pwa.ts");

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const btn = document.getElementById("install-btn") as HTMLButtonElement;
    btn.click(); // no beforeinstallprompt fired first -> no deferredPrompt

    expect(log).toHaveBeenCalledWith("[PWA] No deferred prompt available");
  });

  test("accepted install prompt hides the install button", async () => {
    mockNavigator(false);
    // jsdom/happy-dom cannot construct BeforeInstallPromptEvent; a plain
    // Event carries the prompt()/userChoice contract via Object.assign.
    const promptFn = vi.fn();
    const evt = Object.assign(new Event("beforeinstallprompt"), {
      preventDefault: () => {},
      prompt: promptFn,
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });

    await import("../js/pwa.ts");

    const btn = document.getElementById("install-btn") as HTMLButtonElement;
    btn.style.display = "inline-block";
    fire("beforeinstallprompt");
    // Re-fire with the enriched event object.
    for (const fn of winListeners.get("beforeinstallprompt") ?? []) {
      (fn as any).call(window, evt);
    }
    btn.click();

    await Promise.resolve();
    await Promise.resolve();

    expect(promptFn).toHaveBeenCalled();
    expect(btn.style.display).toBe("none");
  });
});
