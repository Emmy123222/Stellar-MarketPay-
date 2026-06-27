declare module "@/lib/i18n" {
  export function useTranslation(
    ns?: string,
  ): {
    t: (key: string, options?: Record<string, unknown>) => string;
    i18n: typeof import("i18next").default;
    ready: boolean;
  };

  export function appWithTranslation<T>(Component: React.ComponentType<T>): React.ComponentType<T>;

  declare const i18next: typeof import("i18next").default;
  export default i18next;
}
