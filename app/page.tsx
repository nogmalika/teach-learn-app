"use client";

import { useState } from "react";

interface Message {
  role: "user" | "student" | "teacher" | "system";
  content: string;
}

export default function Home() {
  const [topic, setTopic] = useState("");
  const [isStarted, setIsStarted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [exchangeCount, setExchangeCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isFinished, setIsFinished] = useState(false);

  const getBotLevel = () => {
    if (exchangeCount <= 1) return { name: "🐣 bot (Lv.1: 初心者)", color: "text-amber-600 bg-amber-50" };
    if (exchangeCount <= 3) return { name: "🐥 bot (Lv.2: 見習い)", color: "text-blue-600 bg-blue-50" };
    return { name: "🦉 bot (Lv.3: 熟練者)", color: "text-purple-600 bg-purple-50" };
  };

  const handleStart = () => {
    if (!topic.trim()) return;
    setIsStarted(true);
    const firstMsg = `「${topic}」について勉強したいです！ボク、名前くらいしか知らなくて…どんなものなんですか？超かんたんに教えてください！`;
    setMessages([{ role: "student", content: firstMsg }]);
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    setInput("");
    const newMessages: Message[] = [...messages, { role: "user", content: userText }];
    setMessages(newMessages);
    setIsLoading(true);

    const nextCount = exchangeCount + 1;
    setExchangeCount(nextCount);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "chat",
          topic,
          chatHistory: newMessages.map((m) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: m.content,
          })),
          exchangeCount: nextCount,
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setMessages((prev) => [...prev, { role: "student", content: data.reply }]);
    } catch (err: any) {
      alert("エラーが発生しました: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinish = async () => {
    setIsFinished(true);
    setIsLoading(true);
    setMessages((prev) => [...prev, { role: "system", content: "🎓 先生AIがこれまでの会話を採点中..." }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "review",
          topic,
          chatHistory: messages.map((m) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: m.content,
          })),
          exchangeCount,
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setMessages((prev) => [...prev, { role: "teacher", content: data.reply }]);
    } catch (err: any) {
      alert("採点エラー: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 flex flex-col items-center p-4 md:p-8">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-lg flex flex-col h-[85vh] overflow-hidden border border-slate-200">
        <header className="bg-indigo-600 text-white p-4 flex items-center justify-between">
          <div>
            <h1 className="font-bold text-lg">Teach to Learn AI</h1>
            <p className="text-xs text-indigo-100">教えることで身につくアウトプット学習</p>
          </div>
          {isStarted && (
            <div className={`text-xs px-3 py-1 rounded-full font-bold ${getBotLevel().color}`}>
              {getBotLevel().name}
            </div>
          )}
        </header>

        {!isStarted ? (
          <div className="flex-1 flex flex-col justify-center items-center p-6 text-center">
            <div className="text-5xl mb-4">🐣 ➡️ 🦉</div>
            <h2 className="text-xl font-bold text-slate-800 mb-2">何を教えますか？</h2>
            <p className="text-sm text-slate-500 mb-6 max-w-sm">
              何も知らないbotに知識を教えて育てましょう。最後に先生AIが理解度を採点します。
            </p>
            <div className="w-full max-w-md flex gap-2">
              <input
                type="text"
                placeholder="テーマ（例: 胃粘膜の防御機構, Git, 光合成）"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="flex-1 px-4 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800"
              />
              <button
                onClick={handleStart}
                className="bg-indigo-600 text-white font-bold px-6 py-2 rounded-xl hover:bg-indigo-700 transition"
              >
                開始
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`flex flex-col ${
                    m.role === "user"
                      ? "items-end"
                      : m.role === "teacher" || m.role === "system"
                      ? "items-center"
                      : "items-start"
                  }`}
                >
                  <span className="text-[10px] text-slate-400 font-bold mb-1">
                    {m.role === "user" ? "あなた (先生)" : m.role === "student" ? "生徒bot" : m.role === "teacher" ? "🎓 先生AI" : ""}
                  </span>
                  <div
                    className={`p-3 rounded-2xl max-w-[85%] text-sm leading-relaxed whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-indigo-600 text-white rounded-br-none"
                        : m.role === "student"
                        ? "bg-slate-100 text-slate-800 rounded-bl-none border border-slate-200"
                        : m.role === "teacher"
                        ? "bg-amber-50 text-amber-900 border border-amber-300 w-full"
                        : "bg-slate-200 text-slate-600 text-xs py-1"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {isLoading && <div className="text-xs text-slate-400 text-center animate-pulse">botが考え中...</div>}
            </div>

            <div className="p-3 border-t bg-slate-50 space-y-2">
              {!isFinished ? (
                <>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="botに説明してあげよう..."
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSend()}
                      disabled={isLoading}
                      className="flex-1 px-4 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800"
                    />
                    <button
                      onClick={handleSend}
                      disabled={isLoading}
                      className="bg-indigo-600 text-white font-bold px-4 py-2 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition"
                    >
                      送信
                    </button>
                  </div>
                  <button
                    onClick={handleFinish}
                    disabled={isLoading || messages.length <= 2}
                    className="w-full bg-rose-500 text-white font-bold py-2 rounded-xl text-xs hover:bg-rose-600 disabled:opacity-50 transition"
                  >
                    🎓 教え終わったので答え合わせ（先生を呼ぶ）
                  </button>
                </>
              ) : (
                <button
                  onClick={() => window.location.reload()}
                  className="w-full bg-slate-700 text-white font-bold py-2 rounded-xl text-xs hover:bg-slate-800 transition"
                >
                  🔄 別のテーマで新しく始める
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
