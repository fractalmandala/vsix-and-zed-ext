# vsix-template

Deterministic scaffold for a VS Code / VSCodium webview extension: header with
icon actions, full-width body, maximize/contract. Extracted from `hungnotes` and
`fractalstyler-vscode`.

```bash
node scaffold.mjs my-tool --publisher amrit --install   # -> ./my-tool
cd my-tool && npm run package                            # -> my-tool-0.1.0.vsix
```

Tokens rendered in `template/`: `{{name}}`, `{{AppName}}`, `{{publisher}}`.
See `template/README.md` for the extension points.


## Commands

- Dev: TODO
- Desktop: TODO
- Build: TODO
