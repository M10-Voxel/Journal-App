# Projektgraph mit Graphify

[Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify) ist lokal unter
`graphify-out/tooling/graphify` geklont und in der isolierten Python-Umgebung
`graphify-out/tooling/venv` installiert. Verwendete Version: **0.9.111**,
Commit `18cd78f4b8c9698db861aa8d7ad1adbf3c836642`.

## Graph ansehen und aktualisieren

`graphify-out/graph.html` im Browser öffnen: Knoten suchen, Verbindungen verfolgen
und Cluster filtern. `graphify-out/GRAPH_TREE.html` bietet eine Baumansicht.
`graphify-out/GRAPH_REPORT.md` enthält die Auswertung;
`graphify-out/graph.json` enthält den maschinenlesbaren Graphen.

Im Projektverzeichnis aktualisieren:

```powershell
npm run graph:update
# Nach dem Aktualisieren auch im Browser öffnen:
npm run graph:update -- -Open
```

Der Durchlauf verwendet lokale AST-Analyse (`--code-only`) und deaktiviert
LLM-Backends. Dokumente und Bilder erhalten keine semantische Analyse.
Cluster werden automatisch berechnet und numerisch benannt. Nicht unterstützte
Dateien (beispielsweise CSS) und Dateien ohne extrahierbare Symbole können fehlen.
Die Regeln aus `.gitignore` und `.graphifyignore` werden berücksichtigt;
Installation und Ergebnisse bleiben durch das vorhandene `graphify-out/`-Ignore lokal.

Direkte Abfragen sind ebenfalls möglich:

```powershell
& ./graphify-out/tooling/venv/Scripts/python.exe -m graphify query "calendar"
```

## Installation auf einem weiteren Windows-Rechner

Python 3.11 bis 3.14 und Git vorausgesetzt, im Projektverzeichnis:

```powershell
git clone https://github.com/Graphify-Labs/graphify.git graphify-out/tooling/graphify
git -C graphify-out/tooling/graphify checkout 18cd78f4b8c9698db861aa8d7ad1adbf3c836642
python -m venv graphify-out/tooling/venv
& ./graphify-out/tooling/venv/Scripts/python.exe -m pip install ./graphify-out/tooling/graphify
npm run graph:update
```

Bei Unicode-Problemen mit direkten CLI-Aufrufen vorher
`$env:PYTHONIOENCODING = 'utf-8'` setzen. Das Aktualisierungsskript erledigt dies automatisch.
