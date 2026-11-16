import { toast } from "@/components/ui/toast"

import { copyText, MESSENGER_COPIED, MESSENGER_HINT } from "../messenger"

/**
 * A success toast's **Copy for Messenger** action, offered whenever a slot's
 * member changes (the task form's create and edit, the reassign picker). A
 * copy that works toasts "Copied — paste it in Messenger." and calls
 * `onCopied`; one the browser refuses shows the text to copy by hand, until it
 * is closed.
 */
export function copyForMessengerAction(text: string, onCopied?: () => void) {
  return {
    action: {
      label: "Copy for Messenger",
      onClick: async () => {
        if (await copyText(text)) {
          toast.success(MESSENGER_COPIED)
          onCopied?.()
        } else toast.notice(MESSENGER_HINT, { description: text })
      },
    },
  }
}
