# Project Guidelines

## Environment
- Python 3.13
- use `uv run python` to execute scripts, `uv add` to install packages

## Code Style
- concise, DRY, imperative code — no unnecessary abstractions
- not everything needs to be a class; prefer functions and flat scripts for data work
- avoid verbose print statements — use logging or let results speak
- no boilerplate docstrings or comments that restate the obvious

## Data Science
- use pandas, numpy, and established libraries — don't reinvent the wheel
- be smart about package choices: prefer well-maintained, lightweight libraries
- follow a sequential script pattern (`01-…`, `02-…`) for pipeline steps
- keep data paths relative using `pathlib.Path`; data lives in `data/`
- plots go in `plots/`

## Dependencies
- use context7 to get up-to-date docs on packages and APIs (e.g., OpenAI API)
- prefer adding existing packages over writing custom implementations
