# dimensioniCasa

Configuratore visuale, in pianta (2D), per provare la disposizione dei mobili nelle stanze di casa.

## Uso

Nessuna installazione né build: apri `index.html` in un browser. Per pubblicarlo basta GitHub Pages (branch `main`, cartella radice).

- **Stanze**: più stanze, ognuna con un nome. Si parte da un rettangolo e lo si modifica.
- **Forma e muri**: ogni stanza è un poligono, quindi si possono fare L, rientri e sporgenze. Si modifica da tabella (coordinate dei vertici, lunghezza di ogni parete) o trascinando i vertici. Doppio clic su una parete aggiunge un vertice.
- **Porte e finestre**: posizionate su una parete indicando distanza dall'inizio e larghezza; per le porte anche cardine e verso di apertura (disegnato l'arco).
- **Mobili**: nome, larghezza × profondità, posizione e rotazione. Si trascinano; si "attaccano" ai muri vicini (Alt disattiva snap e calamita). Un ⚠ segnala mobili fuori dalla stanza o sovrapposti.
- **Tasti**: `R` ruota di 90°, `Canc` elimina, frecce spostano di 5 cm (Maiusc: 1 cm), `Ctrl+Z` annulla.
- **Dati**: salvati in automatico nel browser (localStorage). `Esporta`/`Importa` per backup in JSON.

## Convenzioni

- Misure in **centimetri**; `y` cresce verso il basso. Le misure dei muri sono quelle **interne** della stanza; lo spessore disegnato è solo grafico.
- Parete *i* = dal vertice *i* al vertice *i+1* (numerazione da 1 nell'interfaccia).

## Limiti noti

- Solo 2D. Gli archi di apertura delle porte non sono considerati nel controllo delle collisioni.
- Nessuna quota fra mobili e muri, nessuna esportazione immagine/PDF.
