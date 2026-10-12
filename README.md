# dimensioniCasa

Configuratore visuale, in pianta (2D), per provare la disposizione dei mobili nelle stanze di casa.

## Uso

Nessuna installazione né build: apri `index.html` in un browser. Per pubblicarlo basta GitHub Pages (branch `main`, cartella radice).

- **Stanze**: più stanze, ognuna con un nome. Si parte da un rettangolo e lo si modifica.
- **Pareti**: elenco con la lunghezza di ogni parete, da angolo ad angolo. Cambiarla sposta anche il lato opposto, così gli angoli restano retti. Una stanza nuova può essere un rettangolo o una forma a L.
- **Nicchie e pilastri**: sono sezioni a parte, ognuna con la sua scheda e il suo «Elimina». Si indicano parete, distanza dall'inizio o dalla fine, larghezza e profondità. Nicchia = rientro nel muro; pilastro = sporgenza verso l'interno. Se una sezione non entra nella parete o ne copre un'altra viene segnalata e non disegnata.
- **Porte e finestre**: posizionate su una parete (di quelle dell'elenco «Pareti») indicando larghezza e distanza misurata **dall'inizio o dalla fine** della parete (cambiando ancoraggio la posizione non si sposta; allungando la parete l'apertura resta alla stessa distanza dal lato scelto); per le porte anche cardine e verso di apertura (disegnato l'arco).
- **Mobili**: nome, larghezza × profondità, posizione e rotazione. Si trascinano; si "attaccano" ai muri vicini (Alt disattiva snap e calamita). Un ⚠ segnala mobili fuori dalla stanza o sovrapposti.
- **Quote**: con un mobile selezionato, il pulsante «Quote» in alto mostra, per ciascun lato, sempre la distanza dal muro (azzurro, misurata dalla superficie interna) e in più, se davanti c'è un altro mobile, la distanza da quello (arancione tratteggiato).
- **Omino**: «+ Omino» aggiunge una figura vista dall'alto (spalle 63 × 30 cm, il naso indica dove guarda). Si muove e si gira liberamente: niente snap né calamita, e non conta come ingombro nelle sovrapposizioni. Per ruotare qualsiasi mobile selezionato c'è il cerchio sopra di esso (con Alt ruota a gradi liberi).
- **Tasti**: `R` ruota di 90°, `Canc` elimina, frecce spostano di 5 cm (Maiusc: 1 cm), `Ctrl+Z` annulla.
- **Dati**: salvati in automatico nel browser (localStorage). `Esporta`/`Importa` per backup in JSON.

## Convenzioni

- Misure in **centimetri**; `y` cresce verso il basso. Le misure dei muri sono quelle **interne** della stanza (da superficie a superficie, come col metro dentro la stanza); lo spessore disegnato è solo grafico.
- Parete *i* = dall'angolo *i* all'angolo *i+1* (numerazione da 1 nell'interfaccia). Nicchie, pilastri, porte e finestre sono ancorati a una parete e non dipendono dagli angoli.
- Gli angoli si vedono solo nella sezione «Angoli (avanzato)», chiusa di default.

## Limiti noti

- Solo 2D. Gli archi di apertura delle porte non sono considerati nel controllo delle collisioni.
- Le quote sono solo per il mobile selezionato e solo lungo i suoi assi (non il minimo assoluto della distanza). Nessuna esportazione immagine/PDF.
