# Adding a language / Agregar un idioma

RePID Identity discovers languages automatically from JSON files. **No code changes are needed** — one file for the app, one for the website.

*RePID Identity detecta los idiomas automáticamente a partir de archivos JSON. **No hace falta tocar código**: un archivo para la app y otro para el sitio web.*

## 1. The app

1. Copy [`src/renderer/src/locales/en.json`](../src/renderer/src/locales/en.json) to a new file named after the language code ([BCP 47](https://en.wikipedia.org/wiki/IETF_language_tag)): `pt.json`, `fr.json`, `pt-BR.json`, `zh-Hans.json`…
2. Set the metadata at the top:

   ```json
   "_meta": { "name": "Português", "dir": "ltr" }
   ```

   `name` is the language's name **in that language** (it appears in the selector). Use `"dir": "rtl"` for Arabic, Hebrew, Persian, Urdu…
3. Translate every **value**. Never translate keys, and keep placeholders exactly as they are: `{{count}}`, `{{mem}}`, `{{product}}`.
4. Plurals use i18next suffixes. Provide the forms your language needs ([CLDR plural rules](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html)):

   ```json
   "procCount_one": "{{count}} processo",
   "procCount_other": "{{count}} processos"
   ```

   Languages with more forms (Arabic, Polish, Russian…) can add `_zero`, `_two`, `_few`, `_many`.
5. Check it:

   ```bash
   npm run i18n:check   # lists missing or unknown keys
   npm run dev:web      # open Settings → Language and review every screen
   ```

Missing keys fall back to English, so a partial translation still works — but please aim for 100%.

## 2. The website

The website is maintained in a private repository. Once your app translation is merged, the maintainers port it to the website — or, if you want to translate the website copy too, say so in your pull request and we will share the text with you.


## 3. Open a pull request

Title it `i18n: add <Language>` and mention whether you are a native speaker. A second native speaker reviewing is very welcome. Translators are credited in the release notes. Thank you! 🌍
