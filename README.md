<img src="assets/icon.svg" width="64" height="64" alt="">

# pi-image-compression

A [Pi](https://pi.dev) extension that keeps images from bloating the context and every API request.

## Features

1. **Automatic image compression.** Any image in a tool result (for example from `read`) is compressed to at most 100KB (base64-encoded) before it enters the context. It uses Pi's built-in image resizer: it downscales to at most 2000px, picks PNG or JPEG, and lowers quality or size until the limit is met. If compression fails, the original image is kept and a warning is shown.
2. **`ask_about_image` tool.** When the model only needs to check a detail or extract some information from an image, it can call this tool instead of loading the image into the conversation. The image is sent to a separate one-off model call and only the text answer is returned, so the image is never re-sent with later requests.

   | Parameter  | Description                                                              |
   | ---------- | ------------------------------------------------------------------------ |
   | `path`     | Path to the image file (png, jpg, gif, webp)                             |
   | `question` | A question, or instructions on what to describe/extract and in what form |
   | `model`    | Optional `provider/model-id`. Defaults to the current model              |

   The model used must support image input. Token usage of the nested call is reported to Pi.

## Install

```sh
pi install git:github.com/TaiRuiQu/pi-image-compression
```

Or try it without installing:

```sh
pi -e ./index.ts
```

Or copy `index.ts` to `~/.pi/agent/extensions/`.

## Configuration

Environment variables:

| Variable                | Default  | Description                                                    |
| ----------------------- | -------- | -------------------------------------------------------------- |
| `PI_IMAGE_MAX_BYTES`    | `102400` | Max size of a base64-encoded image                             |
| `PI_IMAGE_ASK_MODEL`    | current  | Default model for `ask_about_image`, as `provider/model-id`    |

## Notes

- Only images returned by tools are compressed; images you paste into the prompt are not.
- The size limit applies to the base64 string, so the raw file is roughly 75KB.

## License

[MIT](LICENSE)
