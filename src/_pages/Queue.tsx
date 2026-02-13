import React, { useState, useEffect, useRef } from "react"
import { useQuery } from "react-query"
import ScreenshotQueue from "../components/Queue/ScreenshotQueue"
import {
  Toast,
  ToastTitle,
  ToastDescription,
  ToastVariant,
  ToastMessage
} from "../components/ui/toast"
import QueueCommands from "../components/Queue/QueueCommands"
import { ModelSelector } from "../components/ui/ModelSelector"
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

interface QueueProps {
  setView: React.Dispatch<React.SetStateAction<"queue" | "solutions" | "debug">>
}

const Queue: React.FC<QueueProps> = ({ setView }) => {
  const [toastOpen, setToastOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState<ToastMessage>({
    title: "",
    description: "",
    variant: "neutral"
  })

  const [isTooltipVisible, setIsTooltipVisible] = useState(false)
  const [tooltipHeight, setTooltipHeight] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)

  const [chatInput, setChatInput] = useState("")
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "gemini", text: string }[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const chatInputRef = useRef<HTMLInputElement>(null)

  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [currentModel, setCurrentModel] = useState<string>('gemini-3-flash-preview')

  const barRef = useRef<HTMLDivElement>(null)

  const { data: screenshots = [], refetch } = useQuery<Array<{ path: string; preview: string }>, Error>(
    ["screenshots"],
    async () => {
      try {
        const existing = await window.electronAPI.getScreenshots()
        return existing
      } catch (error) {
        console.error("Error loading screenshots:", error)
        showToast("Error", "Failed to load existing screenshots", "error")
        return []
      }
    },
    {
      staleTime: Infinity,
      cacheTime: Infinity,
      refetchOnWindowFocus: true,
      refetchOnMount: true
    }
  )

  const showToast = (
    title: string,
    description: string,
    variant: ToastVariant
  ) => {
    setToastMessage({ title, description, variant })
    setToastOpen(true)
  }

  const handleDeleteScreenshot = async (index: number) => {
    const screenshotToDelete = screenshots[index]

    try {
      const response = await window.electronAPI.deleteScreenshot(
        screenshotToDelete.path
      )

      if (response.success) {
        refetch()
      } else {
        console.error("Failed to delete screenshot:", response.error)
        showToast("Error", "Failed to delete the screenshot file", "error")
      }
    } catch (error) {
      console.error("Error deleting screenshot:", error)
    }
  }

  // Setup Streaming Listeners
  useEffect(() => {
    const cleanups: (() => void)[] = [];

    // Stream Token
    cleanups.push(window.electronAPI.onGeminiStreamToken((token) => {
      setChatMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.role === 'gemini' && lastMsg.text.endsWith("...")) {
          // Trying to identify the streaming message. 
          // Since we don't have an ID, we assume the last 'gemini' message that is "..." (placeholder) or active is the one.
          // Actually, simpler: when starting stream, we add a message.
          // But wait, we don't have `isStreaming` flag in `Queue` state.
          // We should add it or just append to the last message if it's from gemini.

          // If the last message is from gemini, append to it.
          // If the last message is user, we haven't created the gemini message yet?
          // In handleChatSend we create it.

          const updated = [...prev];
          updated[prev.length - 1] = {
            ...lastMsg,
            text: (lastMsg.text === "..." ? "" : lastMsg.text) + token
          };
          return updated;
        }
        // If last was user, this is the first token, so we might need to add a message?
        // Better to add a placeholder in handleChatSend.
        return prev;
      });
    }));

    // Stream Done
    cleanups.push(window.electronAPI.onGeminiStreamDone(() => {
      setChatLoading(false);
    }));

    // Stream Error
    cleanups.push(window.electronAPI.onGeminiStreamError((error) => {
      setChatLoading(false);
      setChatMessages((msgs) => [...msgs, { role: "gemini", text: "Error: " + String(error) }]);
    }));

    return () => cleanups.forEach(fn => fn());
  }, []);

  const handleChatSend = async () => {
    if (!chatInput.trim()) return
    setChatMessages((msgs) => [...msgs, { role: "user", text: chatInput }])

    // Add placeholder
    setChatMessages((msgs) => [...msgs, { role: "gemini", text: "..." }])

    setChatLoading(true)
    const message = chatInput; // Capture value
    setChatInput("")

    try {
      await window.electronAPI.streamGeminiChat(message)
    } catch (err) {
      setChatLoading(false)
      setChatMessages((msgs) => [...msgs, { role: "gemini", text: "Error: " + String(err) }])
    } finally {
      chatInputRef.current?.focus()
    }
  }

  // Load persisted default model on mount (each session starts with the default)
  useEffect(() => {
    const loadDefaultModel = async () => {
      try {
        // @ts-ignore
        const result = await window.electronAPI.invoke('get-default-model');
        if (result && result.model) {
          setCurrentModel(result.model);
          // Set runtime model to the default
          // @ts-ignore
          window.electronAPI.invoke('set-model', result.model).catch(() => { });
        }
      } catch (error) {
        console.error('Error loading default model:', error);
      }
    };
    loadDefaultModel();
  }, []);

  // Listen for default model changes from Settings
  useEffect(() => {
    // @ts-ignore
    if (!window.electronAPI?.onModelChanged) return;
    // @ts-ignore
    const unsubscribe = window.electronAPI.onModelChanged((modelId: string) => {
      setCurrentModel(prev => prev === modelId ? prev : modelId);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const updateDimensions = () => {
      if (contentRef.current) {
        let contentHeight = contentRef.current.scrollHeight
        const contentWidth = contentRef.current.scrollWidth
        if (isTooltipVisible) {
          contentHeight += tooltipHeight
        }
        window.electronAPI.updateContentDimensions({
          width: contentWidth,
          height: contentHeight
        })
      }
    }

    const resizeObserver = new ResizeObserver(updateDimensions)
    if (contentRef.current) {
      resizeObserver.observe(contentRef.current)
    }
    updateDimensions()

    const cleanupFunctions = [
      window.electronAPI.onScreenshotTaken(() => refetch()),
      window.electronAPI.onResetView(() => refetch()),
      window.electronAPI.onSolutionError((error: string) => {
        showToast(
          "Processing Failed",
          "There was an error processing your screenshots.",
          "error"
        )
        setView("queue")
        console.error("Processing error:", error)
      }),
      window.electronAPI.onProcessingNoScreenshots(() => {
        showToast(
          "No Screenshots",
          "There are no screenshots to process.",
          "neutral"
        )
      })
    ]

    return () => {
      resizeObserver.disconnect()
      cleanupFunctions.forEach((cleanup) => cleanup())
    }
  }, [isTooltipVisible, tooltipHeight])

  // Seamless screenshot-to-LLM flow
  useEffect(() => {
    // Listen for screenshot taken event
    const unsubscribe = window.electronAPI.onScreenshotTaken(async (data) => {
      // Refetch screenshots to update the queue
      await refetch();
      // Show loading in chat
      setChatLoading(true);
      try {
        // Get the latest screenshot path
        const latest = data?.path || (Array.isArray(data) && data.length > 0 && data[data.length - 1]?.path);
        if (latest) {
          // Call the LLM to process the screenshot
          // Use streaming for this too!
          setChatMessages((msgs) => [...msgs, { role: "user", text: "📷 Analyzing screenshot..." }]);
          setChatMessages((msgs) => [...msgs, { role: "gemini", text: "..." }]);

          await window.electronAPI.streamGeminiChat("Describe this image and solve any problem in it.", latest);
        }
      } catch (err) {
        setChatMessages((msgs) => [...msgs, { role: "gemini", text: "Error: " + String(err) }]);
        setChatLoading(false);
      }
    });
    return () => {
      unsubscribe && unsubscribe();
    };
  }, [refetch]);

  const handleTooltipVisibilityChange = (visible: boolean, height: number) => {
    setIsTooltipVisible(visible)
    setTooltipHeight(height)
  }

  const handleChatToggle = () => {
    setIsChatOpen(!isChatOpen)
  }

  const handleSettingsToggle = () => {
    setIsSettingsOpen(!isSettingsOpen)
  }

  const handleModelChange = (modelId: string) => {
    setCurrentModel(modelId)
    window.electronAPI.invoke('set-model', modelId).catch(console.error);
    setChatMessages((msgs) => [...msgs, {
      role: "gemini",
      text: `🔄 Switched to ${modelId}. Ready for your questions!`
    }])
  }


  return (
    <div
      ref={barRef}
      style={{
        position: "relative",
        width: "100%",
        pointerEvents: "auto"
      }}
      className="select-none"
    >
      <div className="bg-transparent w-full">
        <div className="px-2 py-1">
          <Toast
            open={toastOpen}
            onOpenChange={setToastOpen}
            variant={toastMessage.variant}
            duration={3000}
          >
            <ToastTitle>{toastMessage.title}</ToastTitle>
            <ToastDescription>{toastMessage.description}</ToastDescription>
          </Toast>
          <div className="w-fit">
            <QueueCommands
              screenshots={screenshots}
              onTooltipVisibilityChange={handleTooltipVisibilityChange}
              onChatToggle={handleChatToggle}
              onSettingsToggle={handleSettingsToggle}
            />
          </div>
          {/* Conditional Settings Interface */}
          {isSettingsOpen && (
            <div className="mt-4 w-full mx-auto">
              <ModelSelector currentModel={currentModel} onSelectModel={handleModelChange} />
            </div>
          )}

          {/* Conditional Chat Interface */}
          {isChatOpen && (
            <div className="mt-4 w-full mx-auto liquid-glass chat-container p-4 flex flex-col">
              <div className="flex-1 overflow-y-auto mb-3 p-3 rounded-lg bg-white/10 backdrop-blur-md max-h-64 min-h-[120px] glass-content border border-white/20 shadow-lg">
                {chatMessages.length === 0 ? (
                  <div className="text-sm text-gray-600 text-center mt-8">
                    💬 Chat with {currentModel}
                    <br />
                    <span className="text-xs text-gray-500">Take a screenshot (Cmd+H) for automatic analysis</span>
                    <br />
                    <span className="text-xs text-gray-500">Click ⚙️ Models to switch AI providers</span>
                  </div>
                ) : (
                  chatMessages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`w-full flex ${msg.role === "user" ? "justify-end" : "justify-start"} mb-3`}
                    >
                      <div
                        className={`max-w-[80%] px-3 py-1.5 rounded-xl text-xs shadow-md backdrop-blur-sm border ${msg.role === "user"
                          ? "bg-gray-700/80 text-gray-100 ml-12 border-gray-600/40"
                          : "bg-white/85 text-gray-700 mr-12 border-gray-200/50"
                          }`}
                        style={{ wordBreak: "break-word", lineHeight: "1.4" }}
                      >
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[rehypeKatex]}
                          components={{
                            p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0 whitespace-pre-wrap" {...props} />,
                            a: ({ node, ...props }: any) => <a className="underline hover:opacity-80" target="_blank" rel="noopener noreferrer" {...props} />,
                            code: ({ node, ...props }: any) => <code className="bg-black/20 rounded px-1 py-0.5 text-xs font-mono" {...props} />,
                          }}
                        >
                          {msg.text}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ))
                )}
                {chatLoading && (
                  <div className="flex justify-start mb-3">
                    <div className="bg-white/85 text-gray-600 px-3 py-1.5 rounded-xl text-xs backdrop-blur-sm border border-gray-200/50 shadow-md mr-12">
                      <span className="inline-flex items-center">
                        <span className="animate-pulse text-gray-400">●</span>
                        <span className="animate-pulse animation-delay-200 text-gray-400">●</span>
                        <span className="animate-pulse animation-delay-400 text-gray-400">●</span>
                        <span className="ml-2">{currentModel} is replying...</span>
                      </span>
                    </div>
                  </div>
                )}
              </div>
              <form
                className="flex gap-2 items-center glass-content"
                onSubmit={e => {
                  e.preventDefault();
                  handleChatSend();
                }}
              >
                <input
                  ref={chatInputRef}
                  className="flex-1 rounded-lg px-3 py-2 bg-white/25 backdrop-blur-md text-gray-800 placeholder-gray-500 text-xs focus:outline-none focus:ring-1 focus:ring-gray-400/60 border border-white/40 shadow-lg transition-all duration-200"
                  placeholder="Type your message..."
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  disabled={chatLoading}
                />
                <button
                  type="submit"
                  className="p-2 rounded-lg bg-gray-600/80 hover:bg-gray-700/80 border border-gray-500/60 flex items-center justify-center transition-all duration-200 backdrop-blur-sm shadow-lg disabled:opacity-50"
                  disabled={chatLoading || !chatInput.trim()}
                  tabIndex={-1}
                  aria-label="Send"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="white" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-7.5-15-7.5v6l10 1.5-10 1.5v6z" />
                  </svg>
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Queue
