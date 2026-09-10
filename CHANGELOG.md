# Changelog — Zenith Block

Tutte le versioni pubblicate del gioco. Formato ispirato a *Keep a Changelog*.

---

## [1.1.0] — 2026-09-10

### 🆕 Nuove meccaniche

- **🌉 Ponti sospesi (Skybridge)** — blocco orizzontale posabile dal **livello 5** in su.
  Non è un singolo blocco ma una **campata**: si riempie l'intera fila di celle vuote fino
  ai due appoggi, pagando un segmento per cella (max 4). Unendo due torri separate ne
  **fonde le reti di energia e acqua** e **riduce del 30% la spinta del vento** (tetto 60%).
  Se uno dei due appoggi crolla, la campata cade.
- **🚁 Elisuperficie (Helipad)** — posabile solo **in cima a una colonna**; nulla può essere
  costruito sopra. Ogni 3 turni arrivano turisti VIP con un incasso passivo, ma il rumore
  toglie **7 punti di felicità ai 2 residenziali sottostanti**.
- **🌱 Edifici idroponici (Eco-Growth)** — coltura verticale **ancorata** (non cade, si
  aggrappa alle strutture). Se raggiunge una fonte d'acqua — direttamente o attraverso altre
  colture — dopo 5 turni **si espande gratis in una cella libera adiacente** (max 2 generazioni
  per cella). Abbatte l'inquinamento di 3 punti ciascuna.
- **🕴️ Mercato nero (Black Market)** — solo nelle **prime 3 righe**. Paga un incasso immediato
  di 280-460 monete, ma rende **insicura la colonna**: senza una 🚓 **Stazione di Polizia** entro
  3 celle, le residenze di quella colonna perdono il **40% del gettito fiscale**.
- **🚓 Stazione di Polizia** — nuovo blocco di servizio che presidia il quartiere.
- **🍂 Ciclo delle stagioni** — cambia ogni **20 turni**: Estate → Autunno → Inverno → Primavera.
  - *Inverno*: il riscaldamento **raddoppia il consumo energetico dei residenziali**.
  - *Estate*: le centrali in sovraccarico o soffocate possono **incendiarsi da sole**.
  - *Autunno*: raffiche più forti (+35% di spinta del vento).
  - *Primavera*: le colture idroponiche crescono in 3 turni invece di 5.

### 🎓 Onboarding

- **Tutorial guidato interattivo** di 12 passi con riflettore sugli elementi dell'interfaccia
  e della griglia. Tre passi richiedono un'azione reale (seleziona una carta, costruisci una
  casa, costruisci un parco) e la mano viene preparata perché l'istruzione sia sempre
  eseguibile. Parte da solo alla prima partita, si può saltare e rigiocare dal menu.

### ⚖️ Bilanciamento

- Energia e acqua non sono più un unico serbatoio cittadino: ogni **distretto** (componente
  connessa di blocchi) ha la **propria rete**, e la fornitura municipale è ripartita in
  proporzione alle colonne che poggiano a terra. È questo che rende preziosi i ponti.
- Pesi di pescata contestuali per i nuovi blocchi: i ponti compaiono solo con torri
  abbastanza alte, la polizia sale di priorità quando c'è un mercato nero scoperto.

### 📱 Mobile & distribuzione

- **PWA installabile**: `manifest.json` completo, icone PNG 32→512 (più maskable),
  `theme-color` e `background_color` `#121212`, orientamento `portrait`, display `standalone`.
- **Service Worker** (`sw.js`) con precache di tutta l'app, network-first sulle navigazioni e
  cache-first sulle risorse: il gioco funziona **completamente offline**.
- Comportamento da applicazione: niente scroll involontario, niente rimbalzo elastico,
  niente selezione del testo, `touch-action` calibrato per area.
- File `.nojekyll` per la pubblicazione diretta su **GitHub Pages**.
- Generatore di icone PNG senza dipendenze (`npm run icons`).

### 🧪 Qualità

- 153 test headless (logica, DOM simulato, mobile, meccaniche 1.1.0, tutorial).
- Sonda di bilanciamento aggiornata ai 12 tipi di blocco.

---

## [1.0.1] — non rilasciata

Specifiche registrate (impostazioni multi-canale, i18n a 4 lingue, changelog interattivo,
upgrade edifici, gru, zone di altitudine, micro-abitanti, logistica, photo mode, colonna
sonora adattiva, sfida del giorno, trofei e temi). In attesa di sviluppo modulo per modulo.

---

## [1.0.0] — 2026-09-10

Prima versione giocabile.

- Motore proprietario in JavaScript vanilla ES6: game loop a passo fisso, griglia 10×20 con
  gravità, matrice di sinergia dichiarativa, economia con blackout graduale, fisica
  strutturale (carico, tolleranza, centro di massa, torsione), meteo con ciclo giorno/notte,
  cinque eventi dinamici, motore particellare a pool fisso, sintesi audio procedurale su Web
  Audio API, salvataggi JSON su 3 slot con autosave.
- 7 tipi di blocco: Residenziale, Commerciale, Industriale, Parco, Centrale, Serbatoio, Trave.
- Interfaccia completa con HUD, carte, tooltip, cronaca, modali e controlli da tastiera.
