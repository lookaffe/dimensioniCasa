# dimensioniCasa

Configuratore 2D per la disposizione dei mobili. App statica: `index.html`, `style.css`, `app.js` (JS vanilla, SVG), nessun build né dipendenze.

- Si scrive in italiano (UI e commenti).
- Misure sempre in cm. Stanza = angoli (`pts`) + sezioni (`features`: nicchie/pilastri) + aperture (`openings`); il contorno reale si calcola con `outline()`. Sezioni e aperture sono ancorate a una parete (`wall`, `from`, `offset`). Parete *i* va dall'angolo *i* al *i+1*. Vedi README.
- `load()` esegue `migrate()` sui dati vecchi (rientri fatti di vertici sciolti → sezioni). Lo stato si carica in fondo ad `app.js`: non spostarlo in alto, le funzioni `const` non sono ancora definite e l'errore verrebbe nascosto dal `try/catch` (si ripartirebbe da una stanza vuota).
- Il dato è salvato in `localStorage` con chiave `dimensioniCasa.v1`: se cambia la forma dei dati, mantenere la compatibilità o cambiare versione della chiave.
- Il pannello laterale si ridisegna dopo ogni modifica: gli input non vanno ridisegnati mentre si digita (vedi `queuePanel`).
- Test manuale con Playwright (Chromium già installato): aprire `index.html` da `file://`.
