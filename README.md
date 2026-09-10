# 🏙️ ZENITH BLOCK — Vertical Metropolis

City-builder puzzle a **vista laterale** su griglia **10 × 20**, scritto da zero in
**HTML5 Canvas + CSS3 + JavaScript vanilla (ES6 modulare)**.
Nessun engine, nessuna libreria, nessun file audio o immagine: motore di gioco,
grafica e suono sono tutti proprietari e generati proceduralmente.

---

## ▶️ Avvio

I moduli ES richiedono `http://`: aprire `index.html` con doppio click **non funziona**
(il browser blocca gli import per CORS). Serve un server locale — incluso, zero dipendenze:

```bash
npm start            # http://localhost:5173
# oppure
node tools/serve.mjs 8080
```

In alternativa, in VS Code, l'estensione **Live Server** sul file `index.html`.

### Test

```bash
npm test             # 85 test: logica, smoke test con DOM simulato e controlli mobile
npm run balance      # sonda di bilanciamento: gioca 6 partite e stampa le medie
```

---

## 🎮 Come si gioca

Obiettivo: portare la torre alla **riga 20 (linea ZENITH)** avendo raggiunto gli
obiettivi del distretto (popolazione, felicità, tetto di inquinamento).
Toccare lo Zenith senza i requisiti provoca la **saturazione strutturale**: partita finita.

| Comando | Azione |
|---|---|
| `1` … `5` / click | seleziona la carta |
| `←` `→` / `A` `D` | sposta la colonna di mira |
| `Spazio` / `↓` / click | piazza il blocco |
| `X` | modalità demolizione |
| `Q` | scarta la carta selezionata |
| `N` | passa il turno (la città incassa senza costruire) |
| `P` / `Esc` | pausa · `M` audio · `H` aiuto |
| rotellina | scorre le carte in mano |

Un **turno** = un piazzamento (o un passaggio). A ogni turno: incassi → eventi → fisica.

---

## 🧱 Tassonomia dei blocchi e matrice di sinergia

Ogni blocco reagisce ai **4 vicini ortogonali** (sopra, sotto, sinistra, destra).
La regola viene applicata **una volta per ogni vicino** compatibile.

| Blocco | Costo | Peso | Tolleranza | Effetti base | Sinergia con i vicini |
|---|---|---|---|---|---|
| 🏠 **RES** Residenziale | 45 | 25 kg | 280 kg | +5 popolazione, −1 energia, −1 acqua | **+2 felicità** per ogni PAR/COM · **−3 felicità** per ogni IND/POW |
| 🏪 **COM** Commerciale | 65 | 30 kg | 260 kg | +10 monete, −2 energia | **+5 monete** per ogni RES adiacente |
| 🏭 **IND** Industriale | 110 | 50 kg | 380 kg | +25 monete, +2 inquinamento, −2 energia, −1 acqua | **+10 monete** per ogni IND adiacente |
| 🌳 **PAR** Parco | 35 | 5 kg | 130 kg | +10 felicità, −1 inquinamento | richiede un blocco sotto di sé |
| ⚡ **POW** Centrale | 130 | 45 kg | 300 kg | +20 energia, +3 inquinamento | se soffocata dai 4 lati → rischio incendio ×2,4 |
| 💧 **WAT** Serbatoio | 55 | 35 kg | 290 kg | +20 acqua | spegne gli incendi adiacenti (75%) |
| 🔩 **SUP** Trave | 30 | 20 kg | 820 kg | nessuna produzione | **×2 tolleranza** per tutta la colonna sopra (max ×4) |

I costi seguono una **curva di domanda**: ogni copia già costruita rincara il tipo
del 9% (tetto ×4). Demolire fa riscendere il prezzo.
Ogni tipo ha inoltre una **manutenzione** per turno (IND 10, POW 6, COM 4, WAT 3, RES/PAR 1, SUP 0).

---

## 🏗️ Fisica e stabilità strutturale

Tre grandezze governano il crollo:

```
carico(cella)      = somma dei pesi dei blocchi sovrastanti nella colonna
tolleranza(cella)  = capacità_base × 2^(travi SUP sottostanti, max 2) × (0,3 + 0,7 × integrità)
stress(cella)      = carico / tolleranza        → oltre 1,15 la cella si crepa
```

* **Crepe**: `danno = 5 + (stress − 1,15) × 20` per turno; a integrità 0 il blocco crolla
  e tutto ciò che stava sopra cade per gravità.
* **Manutenzione**: una cella sotto il 75% di carico recupera +4 integrità per turno.
* **Centro di massa**: il triangolo disegnato a terra mostra dove cade il baricentro
  rispetto alla base d'appoggio. Se lo scarto normalizzato supera **0,62** la struttura
  si torce e le fondamenta sul lato opposto iniziano a cedere.
* **Vento**: durante le tempeste spinge lateralmente in proporzione all'altezza esposta,
  sommandosi allo sbilanciamento. La torre oscilla visibilmente.

Regola pratica: **una trave alla base di ogni colonna alta**; le colonne di sole
industrie non arrivano allo Zenith, sono troppo pesanti.

---

## 🌩️ Eventi dinamici

Ogni ~6 turni (con varianza) scatta un evento, con probabilità **pesate sullo stato reale**
della città (più è alta e instabile, più il terremoto è probabile; più industrie, più incendi):

| Evento | Effetto |
|---|---|
| 🌋 **Terremoto** | screen shake + danno al 55% dei blocchi, amplificato dall'altezza e attenuato dalle travi; i blocchi a integrità 0 crollano |
| 🔥 **Incendio** | colpisce industrie e centrali soffocate; 22 danni/turno, si propaga ai vicini (16% + vento), spento da WAT adiacente o dalla pioggia |
| 🧪 **Ispezione ecologica** | se l'inquinamento supera 60 → multa proporzionale all'eccesso; se la città è pulita → premio |
| 🧳 **Ondata migratoria** | resa dei residenziali ×2 per 6 turni |
| 🏛️ **Sovvenzione** | contributo una tantum, più generoso se si è in difficoltà |

**Inquinamento** = indice di *densità* (0-150): dipende dal rapporto fra emissioni e
dimensione della città, quindi resta gestibile anche in una metropoli — a patto di
alternare verde e industria.

---

## 🌗 Ciclo giorno/notte e meteo

180 secondi reali = 24 ore di gioco. Il cielo è un gradiente interpolato fra 10 keyframe
orari (notte → alba → giorno → tramonto), sole e luna percorrono un arco, le **finestre
degli edifici si accendono di notte** (e restano spente durante un blackout).
Sei condizioni meteo — sereno, nuvoloso, ventoso, pioggia, tempesta, nebbia — influenzano
vento, incendi, inquinamento e visibilità. Le tempeste portano fulmini con flash e tuono.

---

## 🏛️ Architettura

```
index.html            markup e HUD (tutti gli agganci sono attributi data-*)
css/style.css         interfaccia: layout a griglia, pannelli in vetro, responsive
src/
  main.js             bootstrap: crea Game + UI, applica le preferenze, avvia il loop
  config/Config.js    ogni costante di bilanciamento (nessun numero magico altrove)
  core/
    Engine.js         game loop rAF, deltaTime a passo fisso, macchina a stati
    Grid.js           matrice 10×20, gravità, adiacenze, footprint, serializzazione
    BlockFactory.js   registro dei tipi, attributi e MATRICE DI SINERGIA dichiarativa
    Game.js           orchestratore: regole, turni, livelli, vittoria/sconfitta
  systems/
    EconomyEngine.js  risorse globali, sinergie, tasse, blackout graduale, anteprime
    PhysicsSystem.js  carico, tolleranza, stress, centro di massa, torsione, crolli
    WeatherSystem.js  ciclo giorno/notte, condizioni, vento, palette del cielo
    EventSystem.js    disastri, propagazione incendi, modificatori a scadenza
    ParticleEngine.js pool fisso di 2200 particelle (fumo, polvere, detriti, pioggia…)
    SoundEngine.js    sintesi Web Audio: SFX + musica procedurale che segue l'ora
    SaveSystem.js     slot multipli, autosave, preferenze, import/export JSON
  render/
    RenderEngine.js   canvas: cielo, parallasse, blocchi, shake, inclinazione, ghost
  ui/
    UIController.js   HUD, carte, tooltip, log, modali, input mouse/tocco/tastiera
tests/                test headless (logica + DOM simulato) e sonda di bilanciamento
tools/serve.mjs       server statico senza dipendenze
```

**Principio**: i sistemi non si conoscono fra loro, comunicano solo tramite `EventBus`
(`src/utils/EventBus.js`) con nomi di evento centralizzati in `EVT`. Aggiungere un tipo
di blocco significa aggiungere una voce in `BLOCK_DEFS`: economia, fisica, UI e render
la leggono automaticamente.

Il `RenderEngine` non contiene logica di gioco e il `Game` non tocca il DOM: si può
sostituire il renderer (WebGL, ASCII…) senza riscrivere le regole.

---

## 💾 Schema di salvataggio (JSON)

3 slot su `localStorage` (lo slot 1 è l'autosave, ogni 3 turni) più record e preferenze.
Lo stato è completamente serializzabile, **PRNG incluso**: ricaricare una partita
riproduce la stessa sequenza di eventi.

```jsonc
{
  "schema": "zenithblock.save",
  "version": "1.0.0",
  "savedAt": 1725974400000,
  "meta":  { "level": 2, "turn": 47, "score": 8120, "population": 85,
             "happiness": 62, "height": 14, "name": "Quartiere Meridiano" },
  "state": {
    "rng":     { "seed": 123456789, "state": 987654321 },
    "turn": 47, "level": 2,
    "grid":    { "cols": 10, "rows": 20,
                 "cells": [ { "i": 12, "t": "RES", "c": 3, "r": 0,
                              "h": 100, "b": 0, "p": 5 } ] },
    "economy": { "coins": 1240, "score": 8120, "pollution": 38,
                 "totalEarned": 5600, "totalSpent": 4360, "finesPaid": 0 },
    "weather": { "hour": 18.4, "day": 3, "condition": "rain",
                 "wind": 0.42, "windDir": -1, "timer": 12, "nextChange": 31 },
    "events":  { "turnsToEvent": 3, "timedEffects": [], "history": [] },
    "hand":    ["RES", "PAR", "SUP", "COM", "WAT"],
    "queue":   ["IND", "RES", "PAR"]
  }
}
```

Legenda celle: `i` id · `t` tipo · `c` colonna · `r` riga (0 = fondamenta) ·
`h` integrità · `b` turni di incendio residui · `p` turno di posa.

`SaveSystem` espone anche `exportJSON()` / `importJSON()` per backup e condivisione,
e `validate()` rifiuta gli slot corrotti o di versione incompatibile.

---

## ✨ Effetti (juiciness)

* **Squash & stretch**: i blocchi si schiacciano all'impatto e recuperano elasticamente.
* **Screen shake** proporzionale al peso del blocco, ai crolli e ai terremoti.
* **Particelle**: polvere all'atterraggio, fumo dalle ciminiere, foglie dai parchi di
  giorno e lucciole di notte, scintille dalle centrali, braci dagli incendi, detriti dai
  crolli, monete dagli incassi, pioggia con vento, onde d'urto.
* **Popup fluttuanti**: `−45`, `+120`, `CREPA`, `INCENDIO`, `SPENTO`.
* **Anteprima intelligente**: il blocco fantasma mostra la traiettoria di caduta e i
  badge con monete/felicità/popolazione che otterresti *lì*, sinergie di ritorno incluse.
* **Indicatore del baricentro** a terra, che diventa giallo e poi rosso avvicinandosi
  al ribaltamento.

---

## 🎛️ Bilanciamento

Tutti i parametri stanno in [`src/config/Config.js`](src/config/Config.js).
Dopo ogni modifica conviene rilanciare la sonda:

```bash
npm run balance
```

che gioca 6 partite con un'euristica e riporta turni, livello raggiunto, crolli per
causa, mix di blocchi costruiti e inquinamento medio — il modo più rapido per capire
se una modifica rende il gioco ingiocabile.

Valori di riferimento della build attuale: livello medio raggiunto ~3, inquinamento
medio ~53/150, crolli ~72 su ~360 turni, ripartiti fra sovraccarico, incendio e torsione.

---

## 📱 Su telefono

Il gioco è pensato anche per il tocco:

* **Costruzione a due fasi** — il primo tocco su una colonna *mira* (mostra il blocco
  fantasma, la traiettoria e i badge di resa), il secondo tocco conferma. Trascinando il
  dito si cambia mira senza costruire: nessun piazzamento accidentale.
* **Demolizione a due tocchi** — stessa logica, con la cella bersaglio evidenziata in rosso.
* **Pannelli a cassetto** — sotto i 980 px obiettivi, struttura, cronaca e legenda si aprono
  dal pulsante 📊 e si chiudono toccando fuori.
* **Scheda blocco** — pressione prolungata su una carta (equivalente del passaggio del mouse).
* **Suggerimenti contestuali** sopra la scena spiegano il passo successivo o il motivo di un
  piazzamento rifiutato.
* **Aree sicure** (notch e barre di sistema), niente zoom a doppio tocco, niente
  trascinamento della pagina, bersagli di tocco da 44 px.
* **Manifest PWA**: si può installare dalla home schermo e parte a schermo intero in verticale.
* Su dispositivi a tocco la densità di particelle scende al 55% per non appesantire la GPU.

## 📋 Compatibilità

Chrome / Edge / Firefox / Safari recenti (moduli ES, Canvas 2D, Web Audio, `localStorage`).
L'audio parte al primo click o tasto premuto, come richiesto dalle policy dei browser.
Layout responsive dal desktop al telefono (vedi sezione dedicata), con supporto a
`prefers-reduced-motion` e alle aree sicure dei dispositivi con notch.

## 📄 Licenza

MIT.
