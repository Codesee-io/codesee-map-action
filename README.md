# codesee-map-action

This action is part of the [CodeSee](https://codesee.io) ecosystem. It is used to push data into
the [CodeSee](https://codesee.io) server to enable the mapping feature on your repository.

## Inputs

### `api_token`

*required*

The token used to talk to your CodeSee account. This should be stored in secrets and then sent
to the action.

** todo: Add example of how to do this **

### `webpack_config_path`

The path (relative to your repository root) of the main webpack config for your project, if you
use one.

### `support_typescript`

*true/false* Set to `true` if you want to honor configurations from your `tsconfig.json` file.

## Example Usage

** todo: Add example usage **
