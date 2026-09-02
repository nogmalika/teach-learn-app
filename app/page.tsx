"use client";

import { useState, useRef, useEffect } from "react";
import { db, auth, googleProvider } from "@/lib/firebase";
import { 
  collection, 
  addDoc, 
  serverTimestamp, 
  query, 
  where, 
  onSnapshot 
} from "firebase/firestore";
import { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  User 
} from "firebase/auth";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer 
} from "recharts";

interface Message {
  role: "user" | "student" | "teacher" | "system";
  content: string;
  questionType?: string;
}

interface TextbookSummary {
  coreConcept: string;
  keyMechanisms: string[];
  clinicalSignificance: string;
}

interface ReviewResult {
  totalScore: number;
  accuracyScore: number;
  coverageScore: number;
  clarityScore: number;
  goodPoints: string[];
  improvementPoints: string[];
  generalFeedback: string;
  textbookSummary?: TextbookSummary;
}

interface LearningSession {
  id: string;
  topic: string;
  exchangeCount: number;
  scores: {
    total: number;
    accuracy: number;
    coverage: number;
    clarity: number;
  };
  feedback: ReviewResult;
  createdAt: any;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<"study" | "dashboard">("study");
  const [historySessions, setHistorySessions] = useState<LearningSession[]>([]);

  // チャットセッション状態
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

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 1. ログイン状態の監視
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  // 2. ユーザーに紐づく過去セッションの購読（インデックス不要のクライアントソート）
  useEffect(() => {
    if (!user) {
      setHistorySessions([]);
      return;
    }

    // orderByをクエリから外し、インデックス不要にする
    const q = query(
      collection(db, "learning_sessions"),
      where("userId", "==", user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sessions = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as LearningSession[];

      // クライアント側で作成日時順（昇順）にソート
      sessions.sort((a, b) => {
        const timeA = a.createdAt?.seconds || 0;
        const timeB = b.createdAt?.seconds || 0;
        return timeA - timeB;
      });

      setHistorySessions(sessions);
    }, (error) => {
      console.error("Firestore Listen Error:", error);
    });

    return () => unsubscribe();
  }, [user]);

  // メッセージ自動スクロール
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, reviewResult]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      alert("ログインエラー: " + err.message);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err: any) {
      alert("ログアウトエラー: " + err.message);
    }
  };

  const getBotLevel = () => {
    if (exchangeCount <= 1) return { name: "🐣 Lv.1 (定義・明確化)", color: "text-amber-600 bg-amber-50" };
    if (exchangeCount <= 3) return { name: "🐥 Lv.2 (前提・メカニズム)", color: "text-blue-600 bg-blue-50" };
    return { name: "🦉 Lv.3 (反例・境界推論)", color: "text-purple-600 bg-purple-50" };
  };

  const handleStart = async () => {
    if (!topic.trim() || isLoading) return;
    setIsLoading(true);

    try {
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
      setMessages([{ role: "student", content: firstMsg, questionType: "定義・明確化" }]);
    } catch (err: any) {
      alert("開始エラー: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinish = async (currentHistory: Message[], updatedCovered: string[]) => {
    setIsFinished(true);
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "review",
          topic,
          chatHistory: currentHistory.map((m) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: m.content,
          })),
          exchangeCount,
          targetKeywords,
          coveredKeywords: updatedCovered,
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const cleanJson = data.reply.replace(/```json|```/g, "").trim();
      const parsedReview: ReviewResult = JSON.parse(cleanJson);
      setReviewResult(parsedReview);

      try {
        await addDoc(collection(db, "learning_sessions"), {
          userId: user ? user.uid : "anonymous",
          userEmail: user ? user.email : "anonymous",
          topic,
          exchangeCount,
          targetKeywords,
          coveredKeywords: updatedCovered,
          scores: {
            total: parsedReview.totalScore,
            accuracy: parsedReview.accuracyScore,
            coverage: parsedReview.coverageScore,
            clarity: parsedReview.clarityScore,
          },
          feedback: parsedReview,
          createdAt: serverTimestamp(),
        });
        setSavedStatus(user ? "✅ スコアとQB解説をアカウントに保存しました！" : "✅ スコアを保存しました（ログインすると履歴が蓄積されます）");
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

      if (data.responderRole === "teacher") {
        setErrorCount((prev) => prev + 1);
      } else {
        setErrorCount(0);
      }

      let updatedCovered = [...coveredKeywords];
      if (data.newlyCoveredKeywords && data.newlyCoveredKeywords.length > 0) {
        updatedCovered = Array.from(new Set([...updatedCovered, ...data.newlyCoveredKeywords]));
        setCoveredKeywords(updatedCovered);
      }

      const updatedHistory: Message[] = [
        ...newMessages,
        { role: data.responderRole || "student", content: data.reply, questionType: data.questionType },
      ];
      setMessages(updatedHistory);

      if (data.isAllCompleted) {
        setIsLoading(false);
        setTimeout(() => {
          handleFinish(updatedHistory, updatedCovered);
        }, 1200);
        return;
      }
    } catch (err: any) {
      alert("エラー: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // チャート用データ成形
  const chartData = historySessions.map((s, index) => ({
    name: `${index + 1}. ${(s.topic || "無題").slice(0, 5)}`,
    fullTopic: s.topic,
    総合点: s.scores?.total || 0,
    正確性: (s.scores?.accuracy || 0) * 2.5,
    網羅性: Math.round(((s.scores?.coverage || 0) / 30) * 100),
    構成力: Math.round(((s.scores?.clarity || 0) / 30) * 100),
  }));

  return (
    <main className="min-h-screen bg-slate-100 flex flex-col items-center p-3 md:p-6">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-lg flex flex-col h-[92vh] overflow-hidden border border-slate-200">
        
        {/* ヘッダー */}
        <header className="bg-indigo-600 text-white p-3 md:p-4 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div>
                <h1 className="font-bold text-base md:text-lg">Teach to Learn AI</h1>
                <p className="text-[11px] text-indigo-100">ソクラテス式アウトプット学習</p>
              </div>
              <div className="flex bg-indigo-700/80 p-0.5 rounded-lg text-xs font-semibold">
                <button
                  onClick={() => setActiveTab("study")}
                  className={`px-3 py-1 rounded-md transition ${activeTab === "study" ? "bg-white text-indigo-700 shadow-sm" : "text-indigo-200 hover:text-white"}`}
                >
                  学習する
                </button>
                <button
                  onClick={() => setActiveTab("dashboard")}
                  className={`px-3 py-1 rounded-md transition ${activeTab === "dashboard" ? "bg-white text-indigo-700 shadow-sm" : "text-indigo-200 hover:text-white"}`}
                >
                  📈 スコア推移
                </button>
              </div>
            </div>

            {/* 認証UI */}
            <div className="flex items-center gap-2">
              {user ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-indigo-200 hidden sm:inline">{user.displayName || user.email?.split("@")[0]}</span>
                  <button
                    onClick={handleLogout}
                    className="text-xs bg-indigo-800/80 hover:bg-indigo-900 px-2.5 py-1 rounded-lg border border-indigo-400/30 transition"
                  >
                    ログアウト
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleLogin}
                  className="text-xs bg-white text-indigo-700 font-bold hover:bg-indigo-50 px-3 py-1.5 rounded-lg shadow-sm transition flex items-center gap-1.5"
                >
                  <span>G</span> Googleログイン
                </button>
              )}
            </div>
          </div>

          {/* キーワードリアルタイム進捗 */}
          {activeTab === "study" && isStarted && targetKeywords.length > 0 && (
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

        {/* タブ 1: 学習画面 */}
        {activeTab === "study" && (
          !isStarted ? (
            <div className="flex-1 flex flex-col justify-center items-center p-6 text-center">
              <div className="text-5xl mb-4">🐣 ➡️ 🦉</div>
              <h2 className="text-xl font-bold text-slate-800 mb-2">何を教えますか？</h2>
              <p className="text-sm text-slate-500 mb-6 max-w-sm">
                キーワードを網羅すると自動で採点され、QBスタイルの解説とスコアが記録されます。
              </p>
              <div className="w-full max-w-md flex gap-2">
                <input
                  type="text"
                  placeholder="テーマ（例: 胃粘膜の防御機構, 光合成, 心筋梗塞）"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === "Enter") handleStart();
                  }}
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
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] text-slate-400 font-bold">
                        {m.role === "user"
                          ? "あなた (先生役)"
                          : m.role === "student"
                          ? "生徒bot"
                          : `🎓 先生AI (ヒント段階 ${Math.min(errorCount || 1, 3)})`}
                      </span>
                      {m.questionType && (
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-600 border border-indigo-200 font-semibold">
                          💡 {m.questionType}
                        </span>
                      )}
                    </div>
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

                {/* 採点カード＆QB解説 */}
                {reviewResult && (
                  <div className="space-y-4 mt-6">
                    <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-200 space-y-3">
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

                    {reviewResult.textbookSummary && (
                      <div className="p-4 bg-slate-900 text-slate-100 rounded-2xl shadow-md space-y-3 border border-slate-700">
                        <div className="flex items-center gap-2 border-b border-slate-700 pb-2">
                          <span className="text-sm font-bold text-amber-400">📖 High-Yield 教科書解説（QBスタイル）</span>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[11px] font-bold text-slate-400">【基本概念・病態生理】</span>
                          <p className="text-xs leading-relaxed text-slate-200">{reviewResult.textbookSummary.coreConcept}</p>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[11px] font-bold text-slate-400">【必須メカニズム・ポイント】</span>
                          <ul className="space-y-1">
                            {reviewResult.textbookSummary.keyMechanisms.map((mech, i) => (
                              <li key={i} className="text-xs text-slate-300 flex items-start gap-1.5">
                                <span className="text-amber-400 font-bold">•</span>
                                <span>{mech}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="p-2.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-amber-200 leading-relaxed">
                          <span className="font-bold text-amber-300 block mb-0.5">📌 臨床的意義・国試の急所:</span>
                          {reviewResult.textbookSummary.clinicalSignificance}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {savedStatus && <div className="text-xs text-emerald-600 text-center font-bold">{savedStatus}</div>}
                {isLoading && <div className="text-xs text-slate-400 text-center animate-pulse">思考中...</div>}
                <div ref={messagesEndRef} />
              </div>

              <div className="p-3 border-t bg-slate-50 space-y-2 shrink-0">
                {!isFinished ? (
                  <>
                    <div className="flex gap-2 items-end">
                      <textarea
                        rows={2}
                        placeholder="生徒に教える...（Enterで送信、Shift+Enterで改行）"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={isLoading}
                        className="flex-1 px-4 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 resize-none text-sm"
                      />
                      <button
                        onClick={handleSend}
                        disabled={isLoading}
                        className="bg-indigo-600 text-white font-bold px-4 py-3 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition shrink-0"
                      >
                        送信
                      </button>
                    </div>
                    <div className="flex justify-between items-center px-1">
                      <span className="text-[11px] text-slate-400">キーワードを網羅すると自動で終了します</span>
                      <button
                        onClick={() => handleFinish(messages, coveredKeywords)}
                        disabled={isLoading || messages.length <= 2}
                        className="text-[11px] text-slate-500 hover:text-red-500 underline transition"
                      >
                        途中で学習を終了する
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    onClick={() => window.location.reload()}
                    className="w-full bg-indigo-600 text-white font-bold py-2.5 rounded-xl text-xs hover:bg-indigo-700 transition"
                  >
                    🔄 別のテーマで新しく始める
                  </button>
                )}
              </div>
            </div>
          )
        )}

        {/* タブ 2: スコア推移ダッシュボード */}
        {activeTab === "dashboard" && (
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
            {!user ? (
              <div className="text-center py-16 space-y-4">
                <div className="text-4xl">🔒</div>
                <h3 className="font-bold text-slate-700 text-lg">Googleログインしてスコアを記録しよう</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Googleアカウントでログインした状態で学習を完了すると、ここにスコア推移グラフとQB解説アーカイブが蓄積されます。
                </p>
                <button
                  onClick={handleLogin}
                  className="bg-indigo-600 text-white font-bold px-6 py-2.5 rounded-xl text-sm hover:bg-indigo-700 transition shadow"
                >
                  Googleでログインする
                </button>
              </div>
            ) : historySessions.length === 0 ? (
              <div className="text-center py-16 space-y-3">
                <div className="text-4xl">📊</div>
                <h3 className="font-bold text-slate-700 text-base">まだ保存されたデータがありません</h3>
                <p className="text-xs text-slate-500">
                  現在 <b>{user.displayName || user.email}</b> としてログインしています。<br />
                  「学習する」タブからテーマを教えてセッションを完了（または途中で終了）すると、ここにグラフが表示されます！
                </p>
                <button
                  onClick={() => setActiveTab("study")}
                  className="bg-indigo-600 text-white font-bold px-4 py-2 rounded-xl text-xs hover:bg-indigo-700 transition"
                >
                  学習画面へ戻る
                </button>
              </div>
            ) : (
              <>
                {/* スコア推移チャート */}
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-slate-800 text-sm">📈 スコア推移グラフ（学習履歴）</h3>
                    <span className="text-xs text-slate-500 font-bold">{historySessions.length} 回の学習記録</span>
                  </div>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="#64748B" />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#64748B" />
                        <Tooltip contentStyle={{ fontSize: "12px", borderRadius: "8px", border: "1px solid #CBD5E1" }} />
                        <Legend wrapperStyle={{ fontSize: "11px" }} />
                        <Line type="monotone" dataKey="総合点" stroke="#4F46E5" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                        <Line type="monotone" dataKey="正確性" stroke="#10B981" strokeWidth={2} strokeDasharray="4 4" />
                        <Line type="monotone" dataKey="網羅性" stroke="#F59E0B" strokeWidth={2} strokeDasharray="4 4" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* 過去の学習アーカイブ一覧 */}
                <div className="space-y-3">
                  <h3 className="font-bold text-slate-800 text-sm">📚 学習アーカイブ＆QB解説</h3>
                  <div className="space-y-3">
                    {historySessions.slice().reverse().map((s) => (
                      <div key={s.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-indigo-900 text-sm">{s.topic}</span>
                          <span className="text-xs font-black px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-200">
                            {s.scores?.total} 点
                          </span>
                        </div>
                        <div className="text-xs text-slate-600 flex gap-4">
                          <span>正確性: {s.scores?.accuracy}/40</span>
                          <span>網羅性: {s.scores?.coverage}/30</span>
                          <span>構成力: {s.scores?.clarity}/30</span>
                        </div>
                        {s.feedback?.textbookSummary && (
                          <div className="mt-2 p-2.5 rounded-lg bg-slate-900 text-slate-200 text-xs space-y-1">
                            <span className="font-bold text-amber-400 block text-[11px]">📖 QB High-Yield 要点:</span>
                            <p className="text-[11px] text-slate-300 leading-relaxed">{s.feedback.textbookSummary.coreConcept}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </main>
  );
}
