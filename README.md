# J-TerminaL

Ein kleines Programm zum schnellen Eintragen und Nachsehen im [Journal](https://github.com/M10-Voxel/Journal-App/tree/Windows), wie Raycast oder Spotlight. Es wird nur per Tastatur bedient, hat keine Knöpfe und öffnet sich überall mit **Strg+Alt+Leertaste**.

J-TerminaL ist ein eigener Download und läuft auch ohne die Journal-App. Es nutzt dieselbe Datenbank wie die App, also denselben Vault.

> Stand: Links eine Suchleiste mit `/`-Befehlen (`/Entry` öffnet das Eintragsformular), rechts ein endloser Kalender, der zugleich die Live-Vorschau ist (24-h-Bänder, Anlegen per Rechtsklick wie in der App). Kompaktes Formular mit vier Typen, „Wann“ (Datum │ Start – Ende), Wiederholung als Satz mit Lücken, Tag-, Symbol- und Erinnerungsauswahl. Enter bestätigt nur das Feld, Shift+Enter erstellt und lässt offen, Strg+Enter erstellt und schließt. (docs/input.md) · Plan: [docs/plan.md](docs/plan.md) · Aufgaben: [docs/roadmap.md](docs/roadmap.md)

## Entwicklung

Technik: **Rust**, **Slint** und **SQLite** über `journal-core` aus der Journal-App (Branch `Windows`).

Für den AVIF-Decoder benötigt der Build auf x86 und x64 NASM ab 2.14 im `PATH`.

```
cd j-terminal
cargo test
cargo run -- --data <Test-Ordner>   # nie gegen die echten Journal-Daten
```

`journal-core` wird beim Entwickeln aus `../Journal-App/crates/journal-core` eingebunden (Branch `Windows` als Nachbarordner).

<a href="https://slint.dev"><img src="https://raw.githubusercontent.com/slint-ui/slint/master/logo/MadeWithSlint-logo-whitebg.png" alt="Made with Slint" height="60"></a>

Die Oberfläche ist mit [Slint](https://slint.dev) gebaut, unter der [Slint Royalty-free License 2.0](https://github.com/slint-ui/slint/blob/master/LICENSES/LicenseRef-Slint-Royalty-free-2.0.md).

Dieser Branch enthält nur J-TerminaL. Die Journal-App liegt im Branch `Windows` und wird nie hierher gemergt, und umgekehrt auch nicht.
