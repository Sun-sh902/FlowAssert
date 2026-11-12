# Contributing to FlowAssert

FlowAssert is an early-stage project with one maintainer. Bug reports, examples of real verification problems, and focused pull requests are welcome. For a larger change, please open an issue first.

If you tried FlowAssert, the **I tried FlowAssert** issue form asks how a first check went and where it was unclear; any answer helps. Do not paste real data, keys, values or reports into an issue.

Replies may take some time.

## Principles

- Without enough evidence, FlowAssert does not say Verified.
- A failed read is not a verdict. Missing evidence is not a Mismatch.
- The frontend never calculates a verdict.
- Do not add wording that claims more than the evidence shows.

## Set up

The offline check needs only Python 3.9 or later:

```sh
python3 -m pip install pytest ./offline
python3 -m pytest scripts/dev/tests/test_offline_verify.py
```

The Service and UI need the tools listed in [Development](docs/development.md#requirements):

```sh
scripts/dev/bootstrap.sh --product-harness
scripts/dev/regression.sh --product NEW-LABEL
```

The `--portable` and release profiles report the `protected-custody` gate as BLOCKED outside the original machine. That is expected.

## Changing the code

- `service/vendor/model.py` and the contracts in `service/contracts/` are pinned. Evaluator v1 and the frozen contracts stay unchanged unless an issue agrees a new version.
- Adding or removing a test means updating `scripts/dev/test-inventory.json`.
- Changing a Service file means updating `scripts/dev/backend-current-identity.json`.

Use synthetic data in tests and examples. Never commit real customer data or credentials.

## License

By contributing, you agree that your contribution is licensed under the [Apache License 2.0](LICENSE).
