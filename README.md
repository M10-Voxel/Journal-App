# J-TerminaL

Ein kleines Programm zum schnellen Eintragen und Nachsehen im [Journal](https://github.com/M10-Voxel/Journal-App/tree/Windows), wie Raycast oder Spotlight. Es wird nur per Tastatur bedient, hat keine Knöpfe und öffnet sich überall mit **Strg+Alt+Leertaste**.

J-TerminaL ist ein eigener Download und läuft auch ohne die Journal-App. Es nutzt dieselbe Datenbank wie die App, also denselben Vault.

> Stand: in Planung. Plan: [docs/plan.md](docs/plan.md) · Aufgaben: [docs/roadmap.md](docs/roadmap.md)

## Entwicklung

Technik: **Rust**, **Slint** und **SQLite** über `journal-core` aus der Journal-App (Branch `Windows`).

<a href="https://slint.dev"><img src="https://raw.githubusercontent.com/slint-ui/slint/master/logo/MadeWithSlint-logo-whitebg.png" alt="Made with Slint" height="60"></a>

Die Oberfläche ist mit [Slint](https://slint.dev) gebaut, unter der [Slint Royalty-free License 2.0](https://github.com/slint-ui/slint/blob/master/LICENSES/LicenseRef-Slint-Royalty-free-2.0.md).

Dieser Branch enthält nur J-TerminaL. Die Journal-App liegt im Branch `Windows` und wird nie hierher gemergt, und umgekehrt auch nicht.
