"use client";

import { useState } from "react";
import { db } from "@/lib/firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";

interface Message {
  role: "user" | "student" | "teacher" | "system";
  content: string;
}

interface ReviewResult {
  totalScore: number;
  accuracyScore: number;
  coverageScore: number;
  clarityScore: number;
  goodPoints: string[];
  improvementPoints: string[];
  generalFeedback: string;
}

export default function Home() {
  const [topic, setTopic] = useState("");
  const [isStarted, setIsStarted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [exchangeCount, setExchangeCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [targetKeywords, setTargetKeywords] = useState<string[]>([]);
  const [coveredKeywords, setCoveredKeywords] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);
  const [savedStatus, setSavedStatus] = useState<string | null>(null);

  const getBotLevel = () => {
    if (exchangeCount <= 1) return { name: "🐣 Lv.1 (定義・目的)", color: "text-amber-600 bg-amber-50" };
    if (exchangeCount <= 3) return { name: "🐥 Lv.2 (前提・反例)", color: "text-blue-600 bg-blue-50" };
    return { name: "🦉 Lv.3 (境界・応用)", color: "text-purple-600 bg-purple-50" };
  };

  const handleStart = async () => {
    if (!topic.trim() || isLoading) return;
    setIsLoading(true);

    try {
      // 1. 必須キーワードを自動生成
      const initRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "init", topic }),
      });
      const initData = await initRes.json();
      if (initData.error) throw new Error(initData.error);

      setTargetKeywords(initData.keywords || []);
      setIsStarted(true);

      const firstMsg = `「${topic}」について教えてください！そもそもこれは何のためにあって、一言で言うとどういう概念なんですか？`;
      setMessages([{ role: "student", content: firstMsg }]);
    } catch (err: any) {
      alert("開始エラー: " + err.message);
    } finally {
      setIsLoading(false);
    }
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
          lastUserMessage: userText,
          targetKeywords,
          coveredKeywords,
          errorCount,
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // 先生が出た場合はエラー深度をインクリメント、生徒ならリセット
      if (data.responderRole === "teacher") {
        setErrorCount((prev) => prev + 1);
      } else {
        setErrorCount(0);
      }

      // カバー済みキーワードの更新
      if (data.newlyCoveredKeywords && data.newlyCoveredKeywords.length > 0) {
        setCoveredKeywords((prev) => Array.from(new Set([...prev, ...data.newlyCoveredKeywords])));
      }

      setMessages((prev) => [...prev, { role: data.responderRole || "student", content: data.reply }]);
    } catch (err: any) {
      alert("エラー: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinish = async () => {
    setIsFinished(true);
    setIsLoading(true);

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
          targetKeywords,
          coveredKeywords,
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const cleanJson = data.reply.replace(/```json|```/g, "").trim();
      const parsedReview: ReviewResult = JSON.parse(cleanJson);
      setReviewResult(parsedReview);

      try {
        await addDoc(collection(db, "learning_sessions"), {
          topic,
          exchangeCount,
          targetKeywords,
          coveredKeywords,
          scores: {
            total: parsedReview.totalScore,
            accuracy: parsedReview.accuracyScore,
            coverage: parsedReview.coverageScore,
            clarity: parsedReview.clarityScore,
          },
          feedback: parsedReview,
          createdAt: serverTimestamp(),
        });
        setSavedStatus("✅ 学習スコアと網羅データをデータベースに保存しました！");
      } catch (dbErr) {
        console.error("Firestore Save Error:", dbErr);
        setSavedStatus("⚠️ データベースへの保存をスキップしました");
      }
    } catch (err: any) {
      alert("採点エラー: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 flex flex-col items-center p-3 md:p-6">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-lg flex flex-col h-[90vh] overflow-hidden border border-slate-200">
        <header className="bg-indigo-600 text-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-bold text-lg">Teach to Learn AI</h1>
              <p className="text-xs text-indigo-100">ソクラテス式アウトプット学習</p>
            </div>
            {isStarted && (
              <div className={`text-xs px-3 py-1 rounded-full font-bold ${getBotLevel().color}`}>
                {getBotLevel().name}
              </div>
            )}
          </div>

          {/* リアルタイムキーワードチェックリスト */}
          {isStarted && targetKeywords.length > 0 && (
            <div className="mt-3 pt-3 border-t border-indigo-500/50">
              <div className="text-[11px] font-semibold text-indigo-200 mb-1.5 flex justify-between">
                <span>🎯 網羅すべき重要キーワード</span>
                <span>{coveredKeywords.length} / {targetKeywords.length} 達成</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {targetKeywords.map((kw, i) => {
                  const isDone = coveredKeywords.some((c) => c.toLowerCase().includes(kw.toLowerCase()) || kw.toLowerCase().includes(c.toLowerCase()));
                  return (
                    <span
                      key={i}
                      className={`text-xs px-2.5 py-0.5 rounded-full font-medium transition-all ${
                        isDone
                          ? "bg-emerald-400 text-emerald-950 font-bold shadow-sm"
                          : "bg-indigo-800/60 text-indigo-200 border border-indigo-400/30"
                      }`}
                    >
                      {isDone ? `✓ ${kw}` : `○ ${kw}`}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </header>

        {!isStarted ? (
          <div className="flex-1 flex flex-col justify-center items-center p-6 text-center">
            <div className="text-5xl mb-4">🐣 ➡️ 🦉</div>
            <h2 className="text-xl font-bold text-slate-800 mb-2">何を教えますか？</h2>
            <p className="text-sm text-slate-500 mb-6 max-w-sm">
              テーマを入力すると重要概念が自動設定されます。生徒に教えながらキーワードの全制覇を目指しましょう！
            </p>
            <div className="w-full max-w-md flex gap-2">
              <input
                type="text"
                placeholder="テーマ（例: 胃粘膜の防御機構, 光合成, Git）"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleStart()}
                disabled={isLoading}
                className="flex-1 px-4 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800"
              />
              <button
                onClick={handleStart}
                disabled={isLoading}
                className="bg-indigo-600 text-white font-bold px-6 py-2 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition"
              >
                {isLoading ? "準備中..." : "開始"}
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
                    m.role === "user" ? "items-end" : m.role === "teacher" ? "items-center" : "items-start"
                  }`}
                >
                  <span className="text-[10px] text-slate-400 font-bold mb-1">
                    {m.role === "user"
                      ? "あなた (先生役)"
                      : m.role === "student"
                      ? "生徒bot"
                      : `🎓 先生AI (ヒント段階 ${Math.min(errorCount || 1, 3)})`}
                  </span>
                  <div
                    className={`p-3 rounded-2xl max-w-[85%] text-sm leading-relaxed whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-indigo-600 text-white rounded-br-none"
                        : m.role === "student"
                        ? "bg-slate-100 text-slate-800 rounded-bl-none border border-slate-200"
                        : "bg-amber-50 text-amber-950 border border-amber-300 w-full rounded-xl"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}

              {reviewResult && (
                <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-200 space-y-3 mt-4">
                  <div className="flex justify-between items-center border-b border-indigo-200 pb-2">
                    <span className="font-bold text-indigo-900">🎯 学習スコア</span>
                    <span className="text-2xl font-black text-indigo-600">{reviewResult.totalScore} / 100点</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="bg-white p-2 rounded-lg border">正確性: <b>{reviewResult.accuracyScore}/40</b></div>
                    <div className="bg-white p-2 rounded-lg border">網羅性: <b>{reviewResult.coverageScore}/30</b></div>
                    <div className="bg-white p-2 rounded-lg border">構成力: <b>{reviewResult.clarityScore}/30</b></div>
                  </div>
                  <div className="text-xs text-slate-700 space-y-1">
                    <p className="font-bold text-emerald-700">🌟 良かった点:</p>
                    {reviewResult.goodPoints.map((p, i) => <li key={i} className="list-disc ml-4">{p}</li>)}
                    <p className="font-bold text-amber-700 mt-2">💡 改善ポイント:</p>
                    {reviewResult.improvementPoints.map((p, i) => <li key={i} className="list-disc ml-4">{p}</li>)}
                    <p className="font-bold text-indigo-800 mt-2">📝 総評:</p>
                    <p className="bg-white p-2 rounded-lg border text-slate-600">{reviewResult.generalFeedback}</p>
                  </div>
                </div>
              )}

              {savedStatus && <div className="text-xs text-emerald-600 text-center font-bold">{savedStatus}</div>}
              {isLoading && <div className="text-xs text-slate-400 text-center animate-pulse">思考中...</div>}
            </div>

            <div className="p-3 border-t bg-slate-50 space-y-2">
              {!isFinished ? (
                <>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="生徒に教える...（困ったら「わからない」）"
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
                    className="w-full bg-slate-800 text-white font-bold py-2 rounded-xl text-xs hover:bg-slate-900 disabled:opacity-50 transition"
                  >
                    📊 学習を終了してスコアを確定する
                  </button>
                </>
              ) : (
                <button
                  onClick={() => window.location.reload()}
                  className="w-full bg-indigo-600 text-white font-bold py-2 rounded-xl text-xs hover:bg-indigo-700 transition"
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
