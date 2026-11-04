# TASK-008: Support new generation 6 models and deprecate older models

## Background

The application needs support for additional generation 6 models. Models from
generations earlier than 6 are now considered deprecated.

## Require

Add support for the following models wherever the application offers or uses
language models:

- `6.1-sol`
- `6.1-terra`
- `6-luna`

Treat all models from generations earlier than 6 as deprecated. Reflect this
status in model selection and documentation, and use generation 6 or newer
models in defaults and examples.

## Acceptance

- Each of the three new models can be configured and used successfully for
  supported language-model operations.
- Models from generations earlier than 6 are consistently identified as
  deprecated wherever model choices are presented or documented.
- Defaults and configuration examples use generation 6 or newer models.
