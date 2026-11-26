import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  buildMessengerMessage,
  copyText,
  deliverablesByRole,
} from "./messenger"

const LABELS = {
  writer: "Writer",
  layout_artist: "Layout Artist",
  cartoonist: "Cartoonist",
  photojournalist: "Photojournalist",
  broadcast_journalist: "Broadcast Journalist",
  videojournalist: "Videojournalist",
}
const ID = "00000000-0000-4000-8000-000000000021"
// 17:00 PHT on Friday, October 16, 2026.
const DUE = "2026-10-16T09:00:00+00:00"

describe("buildMessengerMessage", () => {
  it("builds the title, roles, PHT date and link", () => {
    expect(
      buildMessengerMessage(
        {
          id: ID,
          title: "Lay out",
          roles: ["layout_artist"],
          dueAt: DUE,
          referenceUrls: [],
          deliverables: [],
        },
        "https://pillar.example",
        LABELS
      )
    ).toBe(
      `📌 Lay out — Layout Artist · due Fri, Oct 16, 5:00 PM\nhttps://pillar.example/dashboard/tasks/${ID}`
    )
  })

  it("lists the reference links by site under Reference", () => {
    expect(
      buildMessengerMessage(
        {
          id: ID,
          title: "Lay out",
          roles: ["layout_artist"],
          dueAt: DUE,
          referenceUrls: [
            "https://drive.google.com/drive/folders/1",
            "https://www.canva.com/design/2",
            "https://example.org/x",
          ],
          deliverables: [],
        },
        "https://pillar.example",
        LABELS
      )
    ).toBe(
      `📌 Lay out — Layout Artist · due Fri, Oct 16, 5:00 PM\nhttps://pillar.example/dashboard/tasks/${ID}\n\nReference\n• Google Drive: https://drive.google.com/drive/folders/1\n• Canva: https://www.canva.com/design/2\n• example.org: https://example.org/x`
    )
  })

  it("de-duplicates roles and keeps slot order", () => {
    const message = buildMessengerMessage(
      {
        id: ID,
        title: "T",
        roles: ["photojournalist", "layout_artist", "photojournalist"],
        dueAt: new Date(DUE),
        referenceUrls: [],
        deliverables: [],
      },
      "https://pillar.example",
      LABELS
    )
    expect(message).toContain("— Photojournalist / Layout Artist ·")
  })

  it.each(["Asia/Manila", "UTC", "America/Los_Angeles", "Pacific/Kiritimati"])(
    "formats the date the same under %s",
    (zone) => {
      vi.stubEnv("TZ", zone)
      expect(
        buildMessengerMessage(
          {
            id: ID,
            title: "T",
            roles: ["writer"],
            dueAt: DUE,
            referenceUrls: [],
            deliverables: [],
          },
          "https://pillar.example",
          LABELS
        )
      ).toContain("due Fri, Oct 16, 5:00 PM")
    }
  )

  it("takes the link from the site URL it is given, nothing else", () => {
    const message = buildMessengerMessage(
      {
        id: ID,
        title: "T",
        roles: ["writer"],
        dueAt: DUE,
        referenceUrls: [],
        deliverables: [],
      },
      "https://pillar.example",
      LABELS
    )
    expect(message.split("\n")[1]).toBe(
      `https://pillar.example/dashboard/tasks/${ID}`
    )
  })
})

describe("deliverables in the message", () => {
  const base = {
    id: ID,
    title: "Lay out",
    roles: ["layout_artist" as const, "writer" as const],
    dueAt: DUE,
  }
  const head = `📌 Lay out — Layout Artist / Writer · due Fri, Oct 16, 5:00 PM\nhttps://pillar.example/dashboard/tasks/${ID}`

  it("follows Reference with one block per role", () => {
    expect(
      buildMessengerMessage(
        {
          ...base,
          referenceUrls: ["https://drive.google.com/drive/folders/1"],
          deliverables: [
            { role: "layout_artist", urls: ["https://www.canva.com/design/2"] },
            { role: "writer", urls: ["https://docs.google.com/document/d/3"] },
          ],
        },
        "https://pillar.example",
        LABELS
      )
    ).toBe(
      `${head}\n\nReference\n• Google Drive: https://drive.google.com/drive/folders/1\n\nLayout Artist\n• Canva: https://www.canva.com/design/2\n\nWriter\n• Google Docs: https://docs.google.com/document/d/3`
    )
  })

  it("has no Reference block with no reference links, and leaves empty groups out", () => {
    expect(
      buildMessengerMessage(
        {
          ...base,
          referenceUrls: [],
          deliverables: [
            { role: "writer", urls: [] },
            { role: "layout_artist", urls: ["https://www.canva.com/design/2"] },
          ],
        },
        "https://pillar.example",
        LABELS
      )
    ).toBe(`${head}\n\nLayout Artist\n• Canva: https://www.canva.com/design/2`)
  })
})

describe("deliverablesByRole", () => {
  it("merges a role's slots in slot order, then link order, with roles in slot order", () => {
    expect(
      deliverablesByRole(
        [
          { id: "s1", role: "layout_artist" },
          { id: "s2", role: "writer" },
          { id: "s3", role: "layout_artist" },
        ],
        [
          { slotId: "s3", url: "https://c.example/3" },
          { slotId: "s1", url: "https://a.example/1" },
          { slotId: "s1", url: "https://a.example/2" },
        ]
      )
    ).toEqual([
      {
        role: "layout_artist",
        urls: [
          "https://a.example/1",
          "https://a.example/2",
          "https://c.example/3",
        ],
      },
    ])
  })

  it("is empty with no links", () => {
    expect(deliverablesByRole([{ id: "s1", role: "writer" }], [])).toEqual([])
  })
})

describe("copyText", () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it("is true after writing", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    expect(await copyText("hi")).toBe(true)
    expect(writeText).toHaveBeenCalledWith("hi")
  })

  it("is false with no clipboard or a refusal", async () => {
    vi.stubGlobal("navigator", {})
    expect(await copyText("hi")).toBe(false)
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) },
    })
    expect(await copyText("hi")).toBe(false)
  })
})
