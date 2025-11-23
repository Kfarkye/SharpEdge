import React, { useState, useCallback, useMemo } from 'react';

// Types
import type { Message } from '../types';

// Icons
import { Sparkles, User, AlertTriangle, Copy, Check, Terminal } from 'lucide-react';

// --- Configuration & Utilities ---

const observability = {
  trackEvent: (event: string, properties: Record<string, unknown> = {}) => {
    if (process.env.NODE_ENV !== 'production') {
        // console.log(`Event Tracked: ${event}`, properties);
    }
  },
  logError: (error: unknown, context: string, metadata: Record<string, any> = {}) => {
    console.error(JSON.stringify({ level: 'error', timestamp: new Date().toISOString(), context, error: error instanceof Error ? error.message : String(error), metadata }));
  }
};

const cn = (...classes: (string | boolean | undefined | null)[]): string => {
  return classes.filter(Boolean).join(' ');
};

// --- Optimized Text Formatting ---

/**
 * Helper for inline formatting (Bold, Inline Code, Records).
 */
const processInline = (text: string, isModel: boolean, isError: boolean) => {
    let baseTextColor = '';
    let boldTextColor = 'font-semibold';
    let inlineCodeColor = '';

    if (isError) {
        baseTextColor = 'text-red-100';
        boldTextColor = cn(boldTextColor, 'text-white');
        inlineCodeColor = 'bg-red-800/50 text-red-50 border-red-400/30';
    } else if (isModel) {
        baseTextColor = 'text-textPrimary/95';
        boldTextColor = cn(boldTextColor, 'text-textPrimary');
        inlineCodeColor = 'bg-surfaceHighlight/50 text-accent border-border/20';
    } else {
        // User Bubble Logic: 
        // Light Mode: Blue bg -> White text
        // Dark Mode: White bg -> Black text
        baseTextColor = 'text-white/95 dark:text-black/90';
        boldTextColor = cn(boldTextColor, 'text-white dark:text-black');
        inlineCodeColor = 'bg-black/20 text-white dark:bg-black/10 dark:text-black border-white/20 dark:border-black/10';
    }

    // Regex splits by:
    // 1. Bold (**text**)
    // 2. Inline Code (`text`)
    // 3. Record pattern ((10-5-2))
    const parts = text.split(/(\*\*.*?\*\*|`.*?`|\(\d{1,2}-\d{1,2}-\d{1,2}\))/g);
    
    return parts.map((part, partIdx) => {
        if (!part) return null;

        // 1. Bold
        if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={partIdx} className={boldTextColor}>{part.slice(2, -2)}</strong>;
        }

        // 2. Inline Code
        if (part.startsWith('`') && part.endsWith('`')) {
            return (
                <code key={partIdx} className={cn("px-1.5 py-0.5 rounded text-[0.85em] font-mono border mx-0.5 align-middle", inlineCodeColor)}>
                    {part.slice(1, -1)}
                </code>
            );
        }

        // 3. Record Pattern
        if (/^\(\d{1,2}-\d{1,2}-\d{1,2}\)$/.test(part)) {
             const recordStyle = isModel 
                ? "text-[0.85em] font-mono font-medium text-textTertiary mx-1 opacity-90"
                : "text-[0.85em] font-mono font-medium opacity-80 mx-1";
                
             return (
                <span key={partIdx} className={cn("inline-block", recordStyle)} aria-label={`Record: ${part.slice(1,-1)}`}>
                    {part}
                </span>
             );
        }

        return <span key={partIdx} className={baseTextColor}>{part}</span>;
    });
}

interface FormattedTextProps {
    text: string;
    isModel: boolean;
    isError: boolean;
}

/**
 * Enhanced FormattedText with Table and Code Block Support
 */
const FormattedText = React.memo(({ text, isModel, isError }: FormattedTextProps) => {

  const content = useMemo(() => {
      if (!text || text.trim().length === 0) {
        return (
            <p className="text-textSecondary italic text-sm">
                {isError ? "An error occurred, but no details were provided." : "Awaiting analysis..."}
            </p>
        );
      }

      // Split by triple backticks first to handle code blocks safely
      // This regex captures the content inside the backticks
      const codeBlockSplit = text.split(/(```[\s\S]*?```)/g);

      return codeBlockSplit.map((segment, segmentIdx) => {
          // --- 1. Handle Code Blocks ---
          if (segment.startsWith('```') && segment.endsWith('```')) {
              const lines = segment.split('\n');
              const firstLine = lines[0].replace(/```/, '').trim();
              const language = firstLine || 'plaintext';
              const codeContent = lines.slice(1, -1).join('\n'); // Remove first and last lines (fences)

              return (
                  <div key={`code-${segmentIdx}`} className="my-4 rounded-lg overflow-hidden border border-border/10 bg-[#1e1e1e] shadow-inner">
                      <div className="flex items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-white/5">
                          <div className="flex items-center gap-2">
                              <Terminal size={13} className="text-textTertiary" />
                              <span className="text-xs font-mono text-textTertiary uppercase">{language}</span>
                          </div>
                          <CopyButton content={codeContent} />
                      </div>
                      <div className="p-4 overflow-x-auto">
                          <pre className="font-mono text-sm text-gray-300 leading-relaxed">
                              {codeContent}
                          </pre>
                      </div>
                  </div>
              );
          }

          // If not a code block, process normally (paragraphs, tables, lists)
          // Split by double newlines for paragraphs
          const blocks = segment.split(/\n\n+/);

          return blocks.map((block, idx) => {
                const trimmedBlock = block.trim();
                if (!trimmedBlock) return null;
                const key = `${segmentIdx}-${idx}`;

                // --- 2. Handle Tables ---
                if (trimmedBlock.includes('|') && trimmedBlock.includes('---')) {
                    const rows = trimmedBlock.split('\n').filter(row => row.trim().length > 0);
                    if (rows.length >= 3) {
                        const headerRow = rows[0];
                        const separatorRow = rows[1];
                        
                        if (headerRow.includes('|') && separatorRow.includes('---')) {
                            const headers = headerRow.split('|').map(h => h.trim()).filter(h => h);
                            const dataRows = rows.slice(2);
                            
                            return (
                                <div key={key} className="my-4 overflow-hidden rounded-lg border border-border/10 shadow-sm bg-surfaceHighlight/20">
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm text-left border-collapse">
                                            <thead className="bg-surfaceHighlight/50 border-b border-border/10 text-xs uppercase tracking-wider font-semibold text-textSecondary">
                                                <tr>
                                                    {headers.map((header, hIdx) => (
                                                        <th key={hIdx} className="px-4 py-3 whitespace-nowrap">
                                                            {header}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody className={cn("divide-y divide-border/5 font-numeric", isModel ? "text-textPrimary" : "text-white dark:text-black")}>
                                                {dataRows.map((row, rIdx) => {
                                                    const cells = row.split('|').map(c => c.trim()).filter(c => c !== '');
                                                    return (
                                                        <tr key={rIdx} className="hover:bg-surfaceHighlight/30 transition-colors">
                                                            {cells.map((cell, cIdx) => (
                                                                <td key={cIdx} className="px-4 py-2.5">
                                                                    {processInline(cell, isModel, isError)}
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            );
                        }
                    }
                }

                // --- 3. Handle Headers ---
                const sectionHeaderMatch = trimmedBlock.match(/^\*\*(Section\s+\d+\s*–\s*.*?)\*\*$/i);
                if (sectionHeaderMatch) {
                    const headerText = sectionHeaderMatch[1].replace(/Section\s+\d+\s*–\s*/i, ''); 
                    const accentColor = isError 
                        ? 'text-red-400 border-red-400/30' 
                        : (isModel ? 'text-accent border-accent/20' : 'text-white/90 border-white/20 dark:text-black/90 dark:border-black/20');
                    
                    return (
                        <h3 key={key} className="pt-5 pb-1 mt-2" role="heading" aria-level={3}>
                            <span className={cn("text-xs font-bold uppercase tracking-widest border-b pb-1.5", accentColor)}>
                                {headerText}
                            </span>
                        </h3>
                    );
                }

                const headerMatch = trimmedBlock.match(/^(#{1,3})\s+(.*)/);
                if (headerMatch) {
                    const level = headerMatch[1].length;
                    const headerText = headerMatch[2];
                    const headerColor = isModel ? "text-textPrimary" : "text-white dark:text-black";
                    
                    if (level === 1 || level === 2) {
                        return (
                            <h2 key={key} className={cn("text-xl font-bold mt-6 mb-2 tracking-tight", headerColor)} role="heading" aria-level={2}>
                                {processInline(headerText, isModel, isError)}
                            </h2>
                        );
                    } else {
                        return (
                             <h3 key={key} className={cn("text-lg font-semibold mt-4 mb-1", headerColor)} role="heading" aria-level={3}>
                                 {processInline(headerText, isModel, isError)}
                             </h3>
                        );
                    }
                }

                const lines = trimmedBlock.split('\n');

                // --- 4. Handle Lists ---
                if (lines.length > 0 && lines.every(line => line.trim().startsWith('- ') || line.trim().startsWith('* '))) {
                    const items = lines.map(item => item.trim().replace(/^[-*]\s*/, '')).filter(Boolean);
                    return (
                        <ul key={key} className="list-disc pl-5 space-y-2.5" role="list">
                            {items.map((item, i) => (
                                <li key={i}>{processInline(item, isModel, isError)}</li>
                            ))}
                        </ul>
                    );
                }
                
                if (lines.length > 0 && lines.every(line => line.trim().match(/^\d+\.\s/))) {
                    const items = lines.map(item => item.trim().replace(/^\d+\.\s*/, '')).filter(Boolean);
                    return (
                        <ol key={key} className="list-decimal pl-5 space-y-2.5" role="list">
                            {items.map((item, i) => (
                                <li key={i}>{processInline(item, isModel, isError)}</li>
                            ))}
                        </ol>
                    )
                }
                
                // --- 5. Handle Blockquotes ---
                if (trimmedBlock.startsWith('> ')) {
                    const quoteText = trimmedBlock.replace(/^>\s*/gm, '').trim();
                    const quoteStyle = isError 
                        ? 'border-red-500 text-red-100/80' 
                        : (isModel 
                            ? 'border-accent text-textSecondary/90' 
                            : 'border-white/70 text-white/95 dark:border-black/50 dark:text-black');
                    return (
                        <blockquote key={key} className={cn("border-l-4 pl-4 italic my-2", quoteStyle)}>
                            {processInline(quoteText, isModel, isError)}
                        </blockquote>
                    );
                }

                // --- 6. Default Paragraph ---
                return (
                <p key={key}>
                    {processInline(trimmedBlock, isModel, isError)}
                </p>
                );
          });
      });
  }, [text, isModel, isError]);

  return (
    <div className="space-y-5 text-[15px] leading-relaxed font-normal">
      {content}
    </div>
  );
});
FormattedText.displayName = 'FormattedText';


// --- Presentation Components ---

interface AvatarProps {
  isModel: boolean;
  isError: boolean;
}

const Avatar = React.memo(({ isModel, isError }: AvatarProps) => {
  const style = useMemo(() => {
    if (isError) {
      return {
        Icon: AlertTriangle,
        bgClass: 'bg-red-600/90 border-red-500/50 shadow-red-500/30',
        iconClass: 'text-white',
        ariaLabel: "Error Notification Avatar",
      };
    }
    if (isModel) {
      return {
        Icon: Sparkles,
        bgClass: 'bg-gradient-to-br from-gray-800/95 to-black border-white/10 shadow-inner shadow-white/5',
        iconClass: 'text-accent fill-accent/10',
        ariaLabel: "SharpEdge AI Analyst Avatar",
      };
    }
    return {
      Icon: User,
      bgClass: 'bg-gradient-to-tr from-accent to-blue-600 border-white/20',
      iconClass: 'text-white dark:text-black',
      ariaLabel: "User Avatar",
    };
  }, [isModel, isError]);


  return (
    <div 
        className={cn(
            "w-9 h-9 rounded-xl flex items-center justify-center shadow-md border transition-colors duration-300",
            style.bgClass
        )} 
        role="img"
        aria-label={style.ariaLabel}
    >
      <style.Icon size={16} strokeWidth={2.5} className={style.iconClass} aria-hidden="true" />
    </div>
  );
});
Avatar.displayName = 'Avatar';


const CopyButton: React.FC<{ content: string }> = ({ content }) => {
    const [isCopied, setIsCopied] = useState(false);

    const handleCopy = useCallback(() => {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(content).then(() => {
                setIsCopied(true);
                observability.trackEvent('message_copied', { length: content.length });
                
                const timer = setTimeout(() => setIsCopied(false), 2000);
                return () => clearTimeout(timer);

            }).catch(err => {
                observability.logError(err, 'CopyButtonClipboardWrite');
            });
        } else {
            observability.logError("Clipboard API unavailable or context insecure.", 'CopyButtonAvailability');
        }
    }, [content]);

    return (
        <button
            onClick={handleCopy}
            className="p-1.5 rounded-md text-textTertiary hover:bg-surfaceHighlight hover:text-textPrimary transition-colors duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            title={isCopied ? "Copied!" : "Copy"}
            aria-label={isCopied ? "Content copied to clipboard" : "Copy content"}
            aria-live="polite"
        >
            {isCopied 
                ? <Check size={14} strokeWidth={2.5} className="text-green-500 motion-safe:animate-scale-in" /> 
                : <Copy size={14} strokeWidth={2} />}
        </button>
    );
};
CopyButton.displayName = 'CopyButton';


interface MetadataProps {
    timestamp: number;
    latency?: number;
    isModel: boolean;
}

const MessageMetadata = React.memo(({ timestamp, latency, isModel }: MetadataProps) => {
    const timeDetails = useMemo(() => {
        try {
            const date = new Date(timestamp);
            const timeString = date.toLocaleTimeString(navigator.language || 'en-US', { hour: 'numeric', minute: '2-digit' });
            const isoString = date.toISOString();
            return { timeString, isoString };
        } catch (error) {
            observability.logError(error, 'MessageMetadataFormatting', { timestamp });
            return { timeString: "", isoString: "" };
        }
    }, [timestamp]);

    if (!timeDetails.timeString) return null;

    return (
        <div className="text-xs text-textTertiary flex items-center gap-2 mt-1">
            <time dateTime={timeDetails.isoString}>{timeDetails.timeString}</time>
            {isModel && latency !== undefined && (
                <>
                    <span aria-hidden="true">•</span>
                    <span className="font-mono text-[11px]" title={`Response latency: ${latency.toFixed(2)}ms`} aria-label={`Response latency: ${latency.toFixed(0)} milliseconds`}>
                        {latency.toFixed(0)}ms
                    </span>
                </>
            )}
        </div>
    );
});
MessageMetadata.displayName = 'MessageMetadata';


// --- Main ChatMessage Component ---

interface ChatMessageProps {
  message: Message;
}

export const ChatMessage = React.memo(({ message }: ChatMessageProps) => {
  const { role, content, timestamp, isError = false, metadata, id } = message;
  const isModel = role === 'model';

  const bubbleStyle = useMemo(() => {
    if (isError) {
        return 'bg-red-900/60 border border-red-500/50 text-red-100 backdrop-blur-md shadow-lg';
    }
    if (isModel) {
        return 'bg-surface/70 border border-border/15 text-textPrimary backdrop-blur-lg shadow-sm hover:shadow-md transition-shadow duration-300';
    }
    // FIX: Dark mode text fix applied here as well (White accent requires black text)
    return 'bg-accent text-white dark:text-black shadow-glow-sm border border-white/10 dark:border-black/5 shadow-md';
  }, [isModel, isError]);

  const ariaLabel = useMemo(() => {
    const sender = isError ? "System Error" : (isModel ? "SharpEdge AI Analyst" : "User");
    const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `Message from ${sender} at ${time}. Preview: ${content.substring(0, 100)}...`;
  }, [isModel, isError, timestamp, content]);

  return (
    <article 
        className={cn(
            "flex w-full mb-6 md:mb-8 group motion-safe:animate-fadeIn",
            isModel ? 'justify-start' : 'justify-end'
        )}
        aria-label={ariaLabel}
        data-testid="chat-message"
        data-message-id={id}
        data-role={role}
    >
      <div 
        className={cn(
          "flex max-w-full sm:max-w-[90%] lg:max-w-[85%] xl:max-w-[80%] gap-3 sm:gap-4",
          isModel ? 'flex-row' : 'flex-row-reverse'
        )}
      >
        <div className="flex-shrink-0 mt-0.5">
          <Avatar isModel={isModel} isError={isError} />
        </div>
        
        <div className="flex flex-col min-w-0 flex-1">
            <div 
                className={cn(
                    "p-5 rounded-2xl",
                    !isError && (isModel ? 'rounded-tl-sm' : 'rounded-tr-sm'),
                    bubbleStyle
                )}
            >
                <FormattedText text={content} isModel={isModel} isError={isError} />
            </div>

            <div className={cn(
                "flex items-center mt-1 gap-4 px-1",
                isModel ? 'justify-between' : 'justify-end'
            )}>
                <MessageMetadata 
                    timestamp={timestamp} 
                    latency={metadata?.latency}
                    isModel={isModel}
                />
                
                {isModel && !isError && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-300 motion-reduce:opacity-100">
                        <CopyButton content={content} />
                    </div>
                )}
            </div>
        </div>
      </div>
    </article>
  );
});

ChatMessage.displayName = 'ChatMessage';