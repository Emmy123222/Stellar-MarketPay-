import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createInstance } from "i18next";
import LanguageSwitcher from "@/components/LanguageSwitcher";

import en from "@/public/locales/en/common.json";
import es from "@/public/locales/es/common.json";
import fr from "@/public/locales/fr/common.json";
import pt from "@/public/locales/pt/common.json";

function createI18n() {
  const instance = createInstance();
  instance.init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { common: en }, es: { common: es }, fr: { common: fr }, pt: { common: pt } },
    defaultNS: "common",
    interpolation: { escapeValue: false },
  });
  return instance;
}

describe("LanguageSwitcher", () => {
  it("changes the next-i18next language and updates the accessible label", async () => {
    const i18n = createI18n();
    render(
      <I18nextProvider i18n={i18n}>
        <LanguageSwitcher />
      </I18nextProvider>,
    );

    const selector = screen.getByLabelText("Switch Language") as HTMLSelectElement;
    expect(selector.value).toBe("en");
    expect(screen.getByRole("option", { name: "Français" })).toBeInTheDocument();

    fireEvent.change(selector, { target: { value: "es" } });

    await waitFor(() => {
      expect(i18n.language).toBe("es");
      expect(screen.getByLabelText("Cambiar Idioma")).toBeInTheDocument();
    });
    expect(localStorage.getItem("preferredLocale")).toBe("es");
  });
});
