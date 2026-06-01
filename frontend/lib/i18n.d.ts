declare module "@/lib/i18n" {
  export function useTranslation(
    ns?: string,
  ): {
    t: (key: string, options?: object) => string;
    i18n: typeof import("i18next").default;
    ready: boolean;
  };
  export default import("i18next").default;
}
