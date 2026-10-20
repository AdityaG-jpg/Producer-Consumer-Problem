# Producer-Consumer Synchronization Simulator

SLA Project, Operating Systems (Stage 3 - advanced model)
Computer Engineering, Shah & Anchor Kutchhi Engineering College
Rishi Ghoricha (SYCM2-13, 125BTCM1016) and Aditya Ghosh (SYCM2-14, 125BTCM1082)
Guide: Ms. Bhakti Sonawane

## How to run

Double-click `index.html` (Chrome, Edge or Firefox). No installation, server or internet
connection is needed; the project is plain HTML, CSS and JavaScript.

### Simplified layout

The page is one column. Preset, algorithm and buffer type, the Run / Step / Pause / Reset bar and the Live Execution view are always visible. Everything else opens with a click on its heading: **More settings** (numeric inputs, deadlock switch, scheduler), **Performance**, **Semaphore State**, **Code being executed** and **Event Log**. On the two comparison tabs the **Results table**, **Performance charts** and the **sweep** are click-to-open too (the results table opens by itself after a run). No feature was removed. The images in `screenshots/` show the earlier layout.

## What it does

* **Algorithm 1 - Semaphore + Mutex (blocking):** the classical bounded-buffer solution with
  `mutex`, `empty` and `full`. A waiting thread sleeps in the semaphore queue.
* **Algorithm 2 - Busy-waiting spinlock:** threads poll a shared `count` and a
  `test_and_set` lock, so a waiting thread keeps using the CPU.
* **Demo - No synchronization:** reproduces the race condition (lost items, lost updates).
* **Deadlock demo:** tick "Reverse wait() order" with Algorithm 1.
* **Compare Algorithms tab:** runs both algorithms on the same inputs, shows a results table,
  bar charts and a parameter sweep.
* **Buffer type (Stage 3):** every algorithm can run with
  * **Unbuffered** - zero capacity: the producer offers its item at a hand-off point and waits
    until a consumer takes it (rendezvous, semaphores `mutex`, `full`, `taken`);
  * **Bounded** - N slots, the classical solution (`mutex`, `empty`, `full`);
  * **Unbounded** - no limit: producers never wait for space (`mutex`, `full`), memory grows.
* **Buffered vs Unbuffered tab (Stage 3):** runs the same workload with all three buffer types
  and shows makespan, waiting per item, peak memory, CPU efficiency, context switches and a sweep.
* **Unbuffered deadlock demo:** the preset "Unbuffered deadlock" makes the producer call
  `wait(taken)` before `signal(full)`, so producer and consumer wait for each other.

Controls: choose a preset or type inputs, pick an algorithm and a buffer type, then Run / Step / Pause / Reset.

### Scenario links (handy for the live demo)

Anything after `#` in the address bar sets up a scenario, for example

* `index.html#preset=unbuffered&steps=23` - load a preset and run 23 ticks
* `index.html#preset=balanced&cores=4&buffer=unbounded` - override single inputs
* `index.html#preset=balanced&cores=4&tab=buffers&run=1` - open the buffer comparison and run it
* `index.html#preset=unbufferedDeadlock&finish=1` - run to the end (deadlock)

### Automated tests

Open `tests/tests.html`. It runs every input combination for both algorithms and all three
buffer types (9,000+ runs) plus the deadlock, race and validation checks.

## Folder structure

| File | Layer (Stage 1, Figure 3) | Responsibility |
|---|---|---|
| `index.html` | GUI | Page layout |
| `css/style.css` | GUI | Styling, thread-state colours |
| `js/config.js` | GUI Interaction Layer | Input ranges, defaults, presets, validation |
| `js/main.js` | GUI Interaction Layer | Controller: form, buttons, timer, tabs |
| `js/semaphore.js` | Semaphore & Mutex Controller | `Semaphore` (wait/signal + queue), `SpinLock` |
| `js/buffer.js` | Buffer Simulation Engine | Circular bounded buffer + anomaly tracking |
| `js/programs.js` | Producer / Consumer Thread Modules | Instruction lists of every algorithm |
| `js/thread.js` | Producer / Consumer Thread Modules | Simulated thread (pc, state, statistics) |
| `js/simulation.js` | Buffer Simulation Engine | Tick loop, scheduler, deadlock/livelock detection |
| `js/metrics.js` | Visualization & Result Display | Performance parameters, integrity check |
| `js/ui.js` | Visualization & Result Display | Draws buffer, threads, semaphores, code, log |
| `js/charts.js` | Visualization & Result Display | Small SVG chart helpers |
| `js/compare.js` | Visualization & Result Display | Algorithm 1 vs 2, buffered vs unbuffered comparison, sweeps |
| `tests/tests.html` | Validation | Automated test suite (open in a browser) |

## Input ranges

| Input | Range | Default |
|---|---|---|
| Buffer type | Unbuffered / Bounded / Unbounded | Bounded |
| Buffer size N (bounded only) | 1 - 12 | 5 |
| Producers | 1 - 6 | 2 |
| Consumers | 1 - 6 | 2 |
| Items per producer | 1 - 50 | 6 |
| Produce time (ticks) | 1 - 10 | 2 |
| Consume time (ticks) | 1 - 10 | 3 |
| CPU cores | 1 - 4 | 1 |
| Context-switch cost (ticks) | 0 - 5 | 1 |
| Random seed | 0 - 99999 | 7 |

Empty, negative, decimal, non-numeric and out-of-range values are rejected with a message
under the field, and Run/Step stay disabled until every input is valid.
