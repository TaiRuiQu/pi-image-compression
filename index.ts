import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import { type ExtensionAPI, resizeImage } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Max size of the base64-encoded image sent to the provider (100KB).
const MAX_IMAGE_BYTES = Number(process.env.PI_IMAGE_MAX_BYTES) || 100 * 1024;
// Optional default model for ask_about_image, as "provider/model-id". Falls back to the active model.
const ASK_MODEL = process.env.PI_IMAGE_ASK_MODEL;

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

async function compress(data: Uint8Array, mimeType: string): Promise<ImageContent | undefined> {
  const out = await resizeImage(data, mimeType, {
    maxWidth: 2000,
    maxHeight: 2000,
    maxBytes: MAX_IMAGE_BYTES,
    jpegQuality: 70,
  });
  return out ? { type: "image", data: out.data, mimeType: out.mimeType } : undefined;
}

export default function (pi: ExtensionAPI) {
  // 1. Compress every image that enters the context through a tool result (e.g. `read`).
  pi.on("tool_result", async (event, ctx) => {
    if (!event.content.some((c) => c.type === "image")) return;

    let changed = false;
    const content: (TextContent | ImageContent)[] = [];
    for (const block of event.content) {
      if (block.type !== "image" || Math.ceil(block.data.length) <= MAX_IMAGE_BYTES) {
        content.push(block);
        continue;
      }
      const small = await compress(Buffer.from(block.data, "base64"), block.mimeType);
      if (small) {
        content.push(small);
        changed = true;
      } else {
        content.push(block);
        ctx.ui.notify("pi-compress-image: failed to compress an image, sending the original", "warning");
      }
    }
    if (changed) return { content };
  });

  // 2. Ask a (sub) model about an image without keeping the image in the main context.
  pi.registerTool({
    name: "ask_about_image",
    label: "Ask About Image",
    description:
      "Look at an image file in a separate, one-off model call and return only a text answer. The image is NOT added to the conversation context. " +
      "Use it to check a specific detail, find some information in an image, or get a description in a format you specify.",
    promptSnippet: "Ask a question about an image file without loading the image into context",
    promptGuidelines: [
      "Use ask_about_image instead of read when you only need specific information from an image (a detail, text, a yes/no check); use read only if you need to see the image repeatedly.",
      "When calling ask_about_image, state exactly what information you need and in what format, since the answering model has no other context.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Path to the image file (png, jpg, gif, webp)" }),
      question: Type.String({
        description: "The question to answer, or instructions on what to describe/extract and how to report it",
      }),
      model: Type.Optional(
        Type.String({ description: "Optional model as provider/model-id. Defaults to the current model." }),
      ),
    }),

    async execute(_id, params, signal, _onUpdate, ctx) {
      const path = resolve(ctx.cwd, params.path.replace(/^@/, ""));
      const mimeType = MIME_BY_EXT[extname(path).toLowerCase()];
      if (!mimeType) throw new Error(`Unsupported image type: ${extname(path) || path}`);

      let model = ctx.model;
      const spec = params.model ?? ASK_MODEL;
      if (spec) {
        const i = spec.indexOf("/");
        const found = i > 0 ? ctx.modelRegistry.find(spec.slice(0, i), spec.slice(i + 1)) : undefined;
        if (!found) throw new Error(`Unknown model "${spec}", expected provider/model-id`);
        model = found;
      }
      if (!model) throw new Error("No model available");
      if (!model.input.includes("image")) throw new Error(`Model ${model.provider}/${model.id} does not support images`);

      const image = await compress(await readFile(path), mimeType);
      if (!image) throw new Error("Failed to process the image");

      const reply = await ctx.modelRegistry.complete(
        model,
        {
          systemPrompt:
            "You answer questions about an image. Be accurate and concise, report only what is visible, and say so if the requested information is not in the image.",
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: params.question }, image],
              timestamp: Date.now(),
            },
          ],
        },
        { signal },
      );
      if (reply.stopReason === "error" || reply.stopReason === "aborted") {
        throw new Error(reply.errorMessage ?? `Image model call ${reply.stopReason}`);
      }

      const text = reply.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim();
      return {
        content: [{ type: "text", text: text || "(the model returned no text)" }],
        details: { path, model: `${model.provider}/${model.id}` },
        usage: reply.usage,
      };
    },
  });
}
