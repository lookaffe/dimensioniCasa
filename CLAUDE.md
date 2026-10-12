# dimensioniCasa

Configuratore 2D per la disposizione dei mobili. App statica: `index.html`, `style.css`, `app.js` (JS vanilla, SVG), nessun build né dipendenze.

- Si scrive in italiano (UI e commenti).
- Misure sempre in cm; stanza = poligono di vertici; parete *i* va dal vertice *i* al *i+1*. Vedi README.
- Il dato è salvato in `localStorage` con chiave `dimensioniCasa.v1`: se cambia la forma dei dati, mantenere la compatibilità o cambiare versione della chiave.
- Il pannello laterale si ridisegna dopo ogni modifica: gli input non vanno ridisegnati mentre si digita (vedi `queuePanel`).
- Test manuale con Playwright (Chromium già installato): aprire `index.html` da `file://`.
