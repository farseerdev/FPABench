# FPABench

An open performance benchmark for planning engines.

FP&A stands for financial planning and analysis. It is the budgets, forecasts and reports a company is run on. FPABench measures how fast FP&A, EPM and planning software loads, recalculates and queries a realistic P&L model.

> **Status: early draft, version 0.4-draft.** The model is here. The data, the tests, the systems and the results are not. Everything can still change.

## Why

Planning tools advertise "billions of cells". Nobody can check that. FPABench gives a public model, public data and public scripts, so anyone can run any system and see the numbers for themselves.

Planning is more than queries. A planner changes one number, and everything that depends on it must be recalculated before the next report. Database benchmarks such as TPC-H and ClickBench do not time that. FPABench times the whole loop. That means loading data, changing inputs, reading results and changing the model itself.

FPABench follows the example of [ClickBench](https://github.com/ClickHouse/ClickBench).

## Goals

- **Reproducible.** Every result comes from scripts in this repo, on a machine anyone can rent.
- **Realistic.** The model is one that practitioners recognise. The data looks like a real company's.
- **Checked.** Every test has an expected answer. A fast wrong answer is a failure.
- **Open.** Anyone can add a system, fix a translation or report a mistake by pull request.

## The model

A consumer goods company sells food, drinks, home care and personal care products in six countries with four currencies. The model plans and reports its P&L per customer, product and month, from gross sales down to contribution margin and EBIT, in each country's currency and in euros. Actual, budget, two forecasts and a what-if sit side by side.

The model is written in FML, the Financial Modeling Language. FML is a small language for planning models. [model/README.md](model/README.md) explains the business, the calculation and how to read FML.

## The repo

| Path | What it holds |
| --- | --- |
| [`model/`](model/) | The model in FML, and the members of its fixed dimensions |
| [`CHANGELOG.md`](CHANGELOG.md) | Every change to the model, the data, the tests or the method |

Data, tests, systems and the website get their own folders as they arrive.

## Who made this

FPABench is made by Farseer. Farseer's own engine will be one of the entries. That is a good reason to check our work. Everything needed to do so will be in this repo.

## Licence

Code in this repo is licensed under the [Apache License 2.0](LICENSE). The model, the data and the documentation are licensed under [CC BY 4.0](LICENSE-CC-BY-4.0).
