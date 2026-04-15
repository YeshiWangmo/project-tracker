"use client";
import { useState, useEffect } from "react";
import { UserButton, useUser } from "@clerk/nextjs";

export default function Home() {
  const appBaseUrl = "https://project-tracker-nine-phi.vercel.app";
  const [sheets, setSheets] = useState([]);
  const [activeSheetId, setActiveSheetId] = useState(null);
  const [history, setHistory] = useState([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [view, setView] = useState("dashboard");
  const [highlightMode, setHighlightMode] = useState(null);

  // CLERK AUTH STATE
  const { user, isLoaded: clerkLoaded } = useUser();
  
  // UPDATED MODAL STATE
  const [modal, setModal] = useState({ show: false, type: "", title: "", value: "", extra: "", role: "user", editId: null, targetId: null, targetSheetId: null });

  // === NEW STATES FOR CUSTOM DROPDOWN & RIGHT CLICK ===
  const [showSheetDropdown, setShowSheetDropdown] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);

  // Click outside listener to close dropdowns automatically
  useEffect(() => {
    const handleClickOutside = () => {
      setShowSheetDropdown(false);
      setContextMenu(null);
    };
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  const createDefaultSheet = () => ({
    id: Date.now(),
    name: "Main Tracker",
    rows: [{ id: 1, project: "New Project", emails: {}, startDate: "", hasStarted: false, statuses: {}, dueDates: {}, reportStatuses: {}, reportDates: {} }],
    dueTypes: [{ id: 101, title: "Phase 1", reminderDays: [30, 17, 7, 3, 0], scheduleName: "Default (30,17,7,3,0)" }],
    reportCols: [{ id: 301, title: "Loan Doc", reminderDays: [30, 17, 7, 3, 0], scheduleName: "Default (30,17,7,3,0)" }],
    emailCols: [{ id: 201, title: "Stakeholder", role: "receiver" }]
  });

  // --- INITIAL LOAD WITH SAFEGUARDS & ID SYNC FIX ---
  useEffect(() => {
    let isMounted = true;

    const fetchTrackerData = async ({ includeHistory = false, useFallback = false } = {}) => {
      try {
        const resSheets = await fetch("/api/tracker");
        const dbSheets = await resSheets.json();

        const sheetsToLoad = Array.isArray(dbSheets) && dbSheets.length > 0
          ? dbSheets
          : [createDefaultSheet()];

        if (!isMounted) return;

        setSheets(sheetsToLoad);
        setActiveSheetId(prevActiveId => {
          if (prevActiveId && sheetsToLoad.some(s => s.id === prevActiveId)) {
            return prevActiveId;
          }

          const savedActiveId = localStorage.getItem("tracker-active-id");
          const parsedId = savedActiveId ? JSON.parse(savedActiveId) : null;
          if (parsedId && sheetsToLoad.some(s => s.id === parsedId)) {
            return parsedId;
          }

          return sheetsToLoad[0]?.id ?? null;
        });

        if (includeHistory) {
          const resHistory = await fetch("/api/history");
          const dbHistory = await resHistory.json();
          if (isMounted && Array.isArray(dbHistory) && dbHistory.length > 0) {
            setHistory(dbHistory);
          }
        }
      } catch (error) {
        console.error("Failed to fetch from DB:", error);

        if (useFallback && isMounted) {
          const fallbackSheet = createDefaultSheet();
          setSheets([fallbackSheet]);
          setActiveSheetId(fallbackSheet.id);
        }
      } finally {
        if (isMounted) {
          setIsLoaded(true);
        }
      }
    };

    fetchTrackerData({ includeHistory: true, useFallback: true });

    const intervalId = setInterval(() => {
      fetchTrackerData();
    }, 30000);

    const handleFocus = () => {
      fetchTrackerData();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  // --- SAVE ALL DATA TO CLOUD ---
  useEffect(() => {
    if (isLoaded) {
      const saveTimer = setTimeout(async () => {
        try {
          await fetch("/api/tracker", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sheets) });
          
          // 🚨 FIX: TEMPORARILY DISABLED HISTORY SAVE TO PREVENT CRASH
          await fetch("/api/history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(history) });
        } catch (error) {
          console.error("Failed to save to DB:", error);
        }
      }, 1000);

      if (activeSheetId) {
        localStorage.setItem("tracker-active-id", JSON.stringify(activeSheetId));
      }
      return () => clearTimeout(saveTimer);
    }
  }, [sheets, activeSheetId, history, isLoaded]);

  const activeSheet = sheets.find(s => s.id === activeSheetId) || sheets[0];
  const rows = activeSheet?.rows || [];
  const activeRows = rows.filter(row => !row.isDeleted);
  const dueTypes = activeSheet?.dueTypes || [];
  const reportCols = activeSheet?.reportCols || [];
  const emailCols = activeSheet?.emailCols || [];

  const totalProjects = rows.length;
  let clearedProjects = 0;
  let pendingProjects = 0;

  rows.forEach(row => {
    const isDuesCleared = dueTypes.every(dt => row.statuses?.[dt.id] === "Cleared");
    const isReportsCleared = reportCols.every(rc => row.reportStatuses?.[rc.id] === "Cleared");
    
    if ((dueTypes.length > 0 || reportCols.length > 0) && isDuesCleared && isReportsCleared) {
      clearedProjects++;
    } else {
      pendingProjects++;
    }
  });

  const currentUserLabel =
    user?.fullName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress ||
    "Clerk User";
  const userEmail = user?.primaryEmailAddress?.emailAddress || "";
  const adminEmails = process.env.NEXT_PUBLIC_ADMIN_EMAIL ? process.env.NEXT_PUBLIC_ADMIN_EMAIL.split(",").map(e => e.trim()) : [];
  const isAdmin = adminEmails.includes(userEmail);

  const triggerEmail = async (emailAddr, project, type, options = {}) => {
    if (!emailAddr || !emailAddr.includes("@")) return;
    try {
      await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: emailAddr,
          project,
          sheetName: activeSheet?.name || "Tracker",
          type,
          ...options
        })
      });
      setHistory(prev => [{
        id: Date.now(), recipient: emailAddr, project, type,
        timestamp: new Date().toLocaleString(), user: currentUserLabel
      }, ...prev]);
    } catch (e) { console.error(e); }
  };

  const getRowRecipients = (row, emailColumns = []) => {
    const recipients = [];

    emailColumns.forEach(col => {
      const emailString = row.emails?.[col.id];
      if (typeof emailString !== "string" || !emailString.trim()) return;

      let role = "receiver";
      if (col?.role === "payer" || (col?.title && col.title.toLowerCase().includes("payer"))) {
        role = "payer";
      }

      console.log(`\n[UI] Checking Column: ${col.title || "Unknown"}`);
      console.log(`[UI] DB Role: ${col.role || "undefined"}, Assigned: ${role}`);

      emailString
        .split(/[;,]/)
        .map(email => email.trim())
        .filter(email => email.includes("@"))
        .forEach(address => {
          recipients.push({ address, role });
          console.log(`[UI] => Sending to: ${address} as [${role}]`);
        });
    });

    return recipients;
  };

  // --- NEW AUDIT LOG HELPER ---
  const logActivity = (projectName, actionMessage) => {
    const newLog = {
      id: Date.now(),
      timestamp: new Date().toLocaleString(),
      user: currentUserLabel,
      project: projectName || "System",
      type: actionMessage
    };
    setHistory(prev => [newLog, ...prev]);
  };

  const confirmModal = () => {
    if (modal.type === "RENAME_SHEET") setSheets(sheets.map(s => s.id === activeSheetId ? { ...s, name: modal.value } : s));
    if (modal.type === "DELETE_SHEET") {
      fetch(`/api/tracker?sheetId=${activeSheetId}`, { method: "DELETE" }).catch(err => console.error(err));
      const remaining = sheets.filter(s => s.id !== activeSheetId);
      if (remaining.length > 0) {
        setSheets(remaining);
        setActiveSheetId(remaining[0].id);
      } else {
        const fallbackSheet = createDefaultSheet();
        setSheets([fallbackSheet]);
        setActiveSheetId(fallbackSheet.id);
      }
    }
    if (modal.type === "ADD_SHEET") {
      const newSheet = createDefaultSheet();
      newSheet.name = modal.value || "New Tracker";
      setSheets([...sheets, newSheet]);
      setActiveSheetId(newSheet.id);
    }
    if (modal.type === "ADD_EMAIL_COLUMN") {
      setSheets(sheets.map(s => s.id === activeSheetId ? {...s, emailCols: [...(s.emailCols || []), { id: Date.now(), title: modal.value || "Email", role: modal.extra }]} : s));
    }
    if (modal.type === "ADD_COLUMN" || modal.type === "ADD_REPORT_COLUMN") {
      let days = [30, 17, 7, 3, 0];
      let sName = "Default (30,17,7,3,0)";
      if (modal.extra === "weekly") { days = [7, 0]; sName = "Weekly + Due Date"; }
      if (modal.extra === "monthly") { days = [30, 0]; sName = "Monthly + Due Date"; }
      if (modal.extra === "quarterly") { days = [90, 0]; sName = "Quarterly + Due Date"; }
      if (modal.extra === "semi") { days = [180, 0]; sName = "Semi-Annually + Due Date"; }
      if (modal.extra === "annually") { days = [365, 0]; sName = "Annually + Due Date"; }

      setSheets(sheets.map(s => {
        if (s.id === activeSheetId) {
          if (modal.type === "ADD_COLUMN") return {...s, dueTypes: [...s.dueTypes, { id: Date.now(), title: modal.value || "Phase", reminderDays: days, scheduleName: sName }]};
          else return {...s, reportCols: [...(s.reportCols || []), { id: Date.now(), title: modal.value || "Report", reminderDays: days, scheduleName: sName }]};
        }
        return s;
      }));
    }
    if (modal.type === "RENAME_COLUMN") {
      setSheets(sheets.map(s => {
        if (s.id === activeSheetId) {
          return {
            ...s,
            [modal.extra]: s[modal.extra].map(c => c.id === modal.editId ? { ...c, title: modal.value } : c)
          };
        }
        return s;
      }));
    }
    if (modal.type === "SOFT_DELETE") {
      const rowToArchive = sheets.find(s => s.id === modal.targetSheetId)?.rows.find(r => r.id === modal.targetId);
      setSheets(sheets.map(s => s.id === modal.targetSheetId ? {
        ...s,
        rows: s.rows.map(r => r.id === modal.targetId ? { ...r, isDeleted: true } : r)
      } : s));
      logActivity(rowToArchive?.project || "Unknown", "Moved to Recycle Bin");
    }
    if (modal.type === "PERM_DELETE") {
      const rowToDelete = sheets.find(s => s.id === modal.targetSheetId)?.rows.find(r => r.id === modal.targetId);
      setSheets(sheets.map(s => s.id === modal.targetSheetId ? {
        ...s,
        rows: s.rows.filter(r => r.id !== modal.targetId)
      } : s));
      logActivity(rowToDelete?.project || "Unknown", "Permanently Deleted");
    }
    setModal({ show: false, type: "", title: "", value: "", extra: "", role: "user", editId: null, targetId: null, targetSheetId: null });
  };

  if (!isLoaded || !clerkLoaded) return null;

  // === MASTER EXPORT: ALL DATA IN SYSTEM ===
  const exportDataToCSV = () => {
    let csvContent = "";

    sheets.forEach(sheet => {
      const safeRows = sheet.rows || [];
      const safeDue = sheet.dueTypes || [];
      const safeRep = sheet.reportCols || [];
      const safeEmail = sheet.emailCols || [];

      if (safeRows.length === 0) return;

      // 1. Build Headers for this Tracker
      const headers = ["Tracker Name", "Project Name", "System Status", "Start Date"];
      safeEmail.forEach(col => headers.push(`Email: ${col.title}`));
      safeDue.forEach(col => {
        headers.push(`Due Date: ${col.title}`);
        headers.push(`Due Status: ${col.title}`);
      });
      safeRep.forEach(col => {
        headers.push(`Report Date: ${col.title}`);
        headers.push(`Report Status: ${col.title}`);
      });

      // 2. Build Rows for this Tracker
      const csvRows = safeRows.map(row => {
        const rowData = [
          `"${sheet.name}"`,
          `"${row.project || ""}"`,
          `"${row.isDeleted ? "DELETED / ARCHIVED" : "ACTIVE"}"`,
          `"${row.startDate || ""}"`
        ];

        safeEmail.forEach(col => rowData.push(`"${row.emails?.[col.id] || ""}"`));
        safeDue.forEach(col => {
          rowData.push(`"${row.dueDates?.[col.id] || ""}"`);
          rowData.push(`"${row.statuses?.[col.id] || "Pending"}"`);
        });
        safeRep.forEach(col => {
          rowData.push(`"${row.reportDates?.[col.id] || ""}"`);
          rowData.push(`"${row.reportStatuses?.[col.id] || "Pending"}"`);
        });

        return rowData.join(",");
      });

      csvContent += headers.join(",") + "\n" + csvRows.join("\n") + "\n\n";
    });

    if (!csvContent) return alert("No data available to export!");

    // 3. Trigger Download
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `Master_System_Export_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click(); 
    document.body.removeChild(link); 
  };

  return (
    <div className="flex h-screen w-full bg-slate-50 font-sans text-slate-800 overflow-hidden">
      {/* RIGHT CLICK CONTEXT MENU */}
      {contextMenu && (
        <div 
          className="fixed bg-white rounded-xl shadow-2xl border border-slate-200 py-2 w-40 z-[100] overflow-hidden"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={e => e.stopPropagation()}
        >
          {/* SHEET OPTIONS */}
          {contextMenu.sheetId && (
            <>
              <button onClick={() => {
                const sheetToRename = sheets.find(s => s.id === contextMenu.sheetId);
                setModal({show:true, type:'RENAME_SHEET', title:'Rename Sheet', value: sheetToRename?.name});
                setContextMenu(null);
              }} className="w-full text-left px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 hover:text-blue-600 transition flex items-center gap-2">
                ✏️ Rename
              </button>
              <button onClick={() => {
                setActiveSheetId(contextMenu.sheetId);
                setModal({show:true, type:'DELETE_SHEET', title:'Delete Sheet'});
                setContextMenu(null);
              }} className="w-full text-left px-4 py-2 text-sm font-bold text-red-500 hover:bg-red-50 transition flex items-center gap-2">
                🗑️ Delete
              </button>
            </>
          )}

          {/* COLUMN OPTIONS */}
          {contextMenu.colId && (
            <>
              <button onClick={() => {
                const colArray = activeSheet[contextMenu.colGroup];
                const colToRename = colArray.find(c => c.id === contextMenu.colId);
                setModal({show:true, type:'RENAME_COLUMN', title:'Rename Column', value: colToRename?.title, extra: contextMenu.colGroup, editId: contextMenu.colId});
                setContextMenu(null);
              }} className="w-full text-left px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 hover:text-blue-600 transition flex items-center gap-2">
                ✏️ Rename
              </button>
              <button onClick={() => {
                setSheets(sheets.map(s => s.id === activeSheetId ? {...s, [contextMenu.colGroup]: s[contextMenu.colGroup].filter(d => d.id !== contextMenu.colId)} : s));
                setContextMenu(null);
              }} className="w-full text-left px-4 py-2 text-sm font-bold text-red-500 hover:bg-red-50 transition flex items-center gap-2">
                🗑️ Delete
              </button>
            </>
          )}
        </div>
      )}
      {/* MODAL */}
      {modal.show && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-4xl p-8 w-full max-w-sm shadow-2xl">
            <h3 className="text-xl font-black mb-4">{modal.title}</h3>
            
            {!(modal.type === "SOFT_DELETE" || modal.type === "PERM_DELETE") && (
              <input placeholder="Type here..." className="w-full bg-slate-50 p-4 rounded-xl outline-none border border-slate-100 mb-4 font-bold" value={modal.value} onChange={e => setModal({...modal, value: e.target.value})}/>
            )}

            {(modal.type === "SOFT_DELETE" || modal.type === "PERM_DELETE") && (
              <p className="text-slate-500 font-medium mb-6">
                Are you sure? {modal.type === 'PERM_DELETE' ? 'This action cannot be undone!' : ''}
              </p>
            )}
            
            {(modal.type === "ADD_COLUMN" || modal.type === "ADD_REPORT_COLUMN") && (
              <select className="w-full bg-slate-50 p-4 rounded-xl outline-none border border-slate-100 mb-4 font-bold text-sm" value={modal.extra} onChange={e => setModal({...modal, extra: e.target.value})}>
                <option value="default">Default (30, 17, 7, 3 days)</option>
                <option value="weekly">Weekly (7 days before)</option>
                <option value="monthly">Monthly (30 days before)</option>
                <option value="quarterly">Quarterly (90 days before)</option>
                <option value="semi">Semi-Annually (180 days before)</option>
                <option value="annually">Annually (365 days before)</option>
              </select>
            )}

            {modal.type === "ADD_EMAIL_COLUMN" && (
              <select className="w-full bg-slate-50 p-4 rounded-xl outline-none border border-slate-100 mb-4 font-bold text-sm" value={modal.extra} onChange={e => setModal({...modal, extra: e.target.value})}>
                <option value="receiver">Receiver (Information Only)</option>
                <option value="payer">Payer (Action Required / Interactive Button)</option>
              </select>
            )}

            <div className="flex gap-3">
              <button onClick={() => setModal({ show: false, type: "", title: "", value: "", extra: "", role: "user", editId: null, targetId: null, targetSheetId: null })} className="flex-1 py-3 font-bold text-slate-400">Cancel</button>
              <button onClick={confirmModal} className="flex-1 py-3 rounded-xl font-bold text-white bg-blue-600">Confirm</button>
            </div>
          </div>
        </div>
      )}

      <aside className="w-64 bg-[#0f172a] text-white p-8 flex flex-col gap-3">
        <div className="text-2xl font-black mb-8 text-blue-500 tracking-tighter">
          {isAdmin ? "Admin Hub" : "Project Tracker"}
        </div>
        
        {/* Dashboard */}
        <button onClick={() => setView("dashboard")} className={`w-full flex items-center justify-start gap-3 px-4 py-3 rounded-xl font-bold transition transform active:scale-95 text-sm ${view === 'dashboard' ? 'bg-blue-600 shadow-lg shadow-blue-900/50 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="20" height="20" className="shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
          </svg>
          Dashboard
        </button>

        {/* Recycle Bin (Archive) */}
        <button onClick={() => setView("archive")} className={`w-full flex items-center justify-start gap-3 px-4 py-3 rounded-xl font-bold transition transform active:scale-95 text-sm ${view === 'archive' ? 'bg-blue-600 shadow-lg shadow-blue-900/50 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="20" height="20" className="shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
          </svg>
          Recycle Bin
        </button>

        {/* Audit Log */}
        <button onClick={() => setView("history")} className={`w-full flex items-center justify-start gap-3 px-4 py-3 rounded-xl font-bold transition transform active:scale-95 text-sm ${view === 'history' ? 'bg-blue-600 shadow-lg shadow-blue-900/50 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="20" height="20" className="shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
          </svg>
          Audit Log
        </button>

        <div className="mt-auto px-4 pb-4">
          <UserButton showName={true} />
        </div>
      </aside>

      <main className="flex-1 p-10 overflow-auto">
        {view === "dashboard" && (
          <>
            {/* SUMMARY CARDS - SIDE BY SIDE GRID */}
            <div className="grid grid-cols-3 gap-6 mb-8">
              
              {/* TOTAL CARD */}
              <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
                <div>
                  <p className="text-slate-500 font-bold text-sm mb-1 uppercase tracking-wider">Total Projects</p>
                  <p className="text-3xl font-black text-slate-800">{activeRows.length}</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" /></svg>
                </div>
              </div>

              {/* PENDING CARD (CLICKABLE) */}
              <div 
                onClick={() => setHighlightMode(highlightMode === 'pending' ? null : 'pending')}
                className={`bg-white p-6 rounded-2xl border ${highlightMode === 'pending' ? 'ring-2 ring-red-500 border-red-500 shadow-md scale-105' : 'border-slate-100 shadow-sm hover:shadow-md hover:-translate-y-1'} flex items-center justify-between cursor-pointer transition-all duration-300`}
              >
                <div>
                  <p className="text-slate-500 font-bold text-sm mb-1 uppercase tracking-wider">Pending</p>
                  <p className="text-3xl font-black text-slate-800">{activeRows.filter(r => (activeSheet.dueTypes || []).some(c => r.statuses?.[c.id] !== 'Cleared' && r.statuses?.[c.id] !== 'N/A') || (activeSheet.reportCols || []).some(c => r.reportStatuses?.[c.id] !== 'Cleared' && r.reportStatuses?.[c.id] !== 'N/A')).length}</p>
                </div>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${highlightMode === 'pending' ? 'bg-red-500 text-white' : 'bg-red-50 text-red-500'}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                </div>
              </div>

              {/* CLEARED CARD (CLICKABLE) */}
              <div 
                onClick={() => setHighlightMode(highlightMode === 'cleared' ? null : 'cleared')}
                className={`bg-white p-6 rounded-2xl border ${highlightMode === 'cleared' ? 'ring-2 ring-green-500 border-green-500 shadow-md scale-105' : 'border-slate-100 shadow-sm hover:shadow-md hover:-translate-y-1'} flex items-center justify-between cursor-pointer transition-all duration-300`}
              >
                <div>
                  <p className="text-slate-500 font-bold text-sm mb-1 uppercase tracking-wider">Cleared</p>
                  <p className="text-3xl font-black text-slate-800">{activeRows.filter(r => !((activeSheet.dueTypes || []).some(c => r.statuses?.[c.id] !== 'Cleared' && r.statuses?.[c.id] !== 'N/A') || (activeSheet.reportCols || []).some(c => r.reportStatuses?.[c.id] !== 'Cleared' && r.reportStatuses?.[c.id] !== 'N/A'))).length}</p>
                </div>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${highlightMode === 'cleared' ? 'bg-green-500 text-white' : 'bg-green-50 text-green-500'}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                </div>
              </div>

            </div>

            <div className="flex justify-between items-center mb-8">
               <div className="flex gap-4 items-center">
                {activeSheet && (
                  <div className="mr-2">
                    <div className="flex items-center gap-3">
                      <h2 className="text-2xl font-black text-slate-800">{activeSheet.name}</h2>
                      {isAdmin && activeSheet.userEmail && (
                        <span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-600">
                          Owner: {activeSheet.userEmail}
                          </span>
                        )}
                        </div>
                  </div>
                )}
                {/* Custom Sheet Dropdown */}
                <div className="relative" onClick={e => e.stopPropagation()}>
                  <button 
                    onClick={() => setShowSheetDropdown(!showSheetDropdown)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, sheetId: activeSheetId });
                    }}
                    className="bg-white font-bold rounded-xl px-4 py-2 shadow-sm border border-slate-200 outline-none flex items-center justify-between min-w-[160px] hover:bg-slate-50 transition"
                  >
                    {activeSheet?.name || "Select Tracker"}
                    <span className="text-[10px] ml-2 text-slate-400">▼</span>
                  </button>

                  {showSheetDropdown && (
                    <div className="absolute top-full left-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-100 py-2 z-40">
                      {sheets.map(s => (
                        <div 
                          key={s.id}
                          onClick={() => { setActiveSheetId(s.id); setShowSheetDropdown(false); }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setActiveSheetId(s.id); 
                            setContextMenu({ x: e.clientX, y: e.clientY, sheetId: s.id });
                            setShowSheetDropdown(false);
                          }}
                          className={`px-4 py-2 cursor-pointer hover:bg-slate-50 transition-colors ${activeSheetId === s.id ? 'text-blue-600 bg-blue-50/50' : 'text-slate-700'}`}
                        >
                          <p className="text-sm font-bold">{s.name}</p>
                          {isAdmin && s.userEmail && (
                            <p className="mt-1 text-[10px] text-slate-400">Owner: {s.userEmail}</p>
                            )}
                        </div>
                      ))}
                      <div className="border-t border-slate-100 mt-1 pt-1"></div>
                      <div 
                        onClick={() => { setModal({show:true, type:'ADD_SHEET', title:'New Tracker Name', value:'New Tracker'}); setShowSheetDropdown(false); }}
                        className="px-4 py-2 text-sm font-bold text-green-600 cursor-pointer hover:bg-green-50 flex items-center gap-2 transition-colors"
                      >
                        + New Sheet
                      </div>
                    </div>
                  )}
                </div>

                {/* NEW EXPORT DATA BUTTON */}
                <button onClick={exportDataToCSV} className="text-xs font-bold text-slate-700 bg-white border border-slate-200 shadow-sm px-4 py-2 rounded-lg hover:bg-slate-50 transition flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="16" height="16" className="text-blue-600 shrink-0">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Export Data (CSV)
                </button>
              </div>
               <div className="flex gap-2">
                <button onClick={() => {
                  setSheets(sheets.map(s => s.id === activeSheetId ? {...s, rows: [...s.rows, {id:Date.now(), project: "New Project", emails:{}, startDate:"", hasStarted: false, statuses:{}, dueDates:{}, reportStatuses:{}, reportDates:{}}]} : s));
                  logActivity("New Project", "Created new project row");
                }} className="bg-white text-slate-700 border px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-slate-50">+ Row</button>
                <button onClick={() => setModal({show:true, type:'ADD_EMAIL_COLUMN', title:'New Email Contact', value:'', extra:'receiver'})} className="bg-sky-100 text-sky-700 px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-sky-200 shadow-sm">+ Email Col</button>
                <button onClick={() => setModal({show:true, type:'ADD_COLUMN', title:'New Due Phase', value:'', extra:'default'})} className="bg-slate-900 text-white px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-slate-800">+ Due Col</button>
                <button onClick={() => setModal({show:true, type:'ADD_REPORT_COLUMN', title:'New Report Task', value:'', extra:'default'})} className="bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-indigo-700 shadow-md shadow-indigo-200">+ Report Col</button>
               </div>
            </div>

            <div className="bg-white rounded-[2.5rem] shadow-xl overflow-x-auto border border-slate-100">
              <table className="w-full text-left whitespace-nowrap">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="p-6 w-12 text-center text-slate-300 font-black">X</th>
                    <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest min-w-37.5">Project Name</th>
                    <th className="p-6 text-[10px] font-black text-blue-500 uppercase tracking-widest border-l border-slate-100 bg-blue-50/30">Start Date</th>

                    {emailCols.map(col => (
                      <th key={col.id} 
                          onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, colId: col.id, colGroup: 'emailCols' }); }}
                          className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest border-l border-slate-100 cursor-context-menu hover:bg-slate-100 transition">
                        {col.title}
                        <div className={`text-[8px] mt-1 ${col.role === 'payer' ? 'text-amber-500' : 'text-sky-500'}`}>{col.role === 'payer' ? 'PAYER (ACTION)' : 'RECEIVER (INFO)'}</div>
                      </th>
                    ))}
                    
                    {dueTypes.map(col => (
                      <th key={col.id} 
                          onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, colId: col.id, colGroup: 'dueTypes' }); }}
                          className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest border-l border-slate-100 cursor-context-menu hover:bg-slate-100 transition">
                        Due: {col.title}
                        <div className="text-[8px] text-blue-500 mt-1">{col.scheduleName || "Default"}</div>
                      </th>
                    ))}

                    {reportCols.map(col => (
                      <th key={col.id} 
                          onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, colId: col.id, colGroup: 'reportCols' }); }}
                          className="p-6 text-[10px] font-black text-indigo-500 uppercase tracking-widest border-l border-slate-100 bg-indigo-50/30 cursor-context-menu hover:bg-indigo-100 transition">
                        Report: {col.title}
                        <div className="text-[8px] text-indigo-400 mt-1">{col.scheduleName || "Default"}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeRows.map((row, index) => {
                    // Check if this specific row has any pending tasks
                    const hasPending = (activeSheet.dueTypes || []).some(c => row.statuses?.[c.id] !== 'Cleared' && row.statuses?.[c.id] !== 'N/A') || 
                                       (activeSheet.reportCols || []).some(c => row.reportStatuses?.[c.id] !== 'Cleared' && row.reportStatuses?.[c.id] !== 'N/A');
                    const projectIsCleared = !hasPending;
                    
                    const rowHighlightClass =
                      highlightMode === "pending" && hasPending
                        ? "project-row-pending"
                        : highlightMode === "cleared" && projectIsCleared
                          ? "project-row-cleared"
                          : "";

                    const rowClass = `border-b border-slate-50 transition-all duration-300 hover:bg-slate-50/30 ${rowHighlightClass}`;

                    return (
                      <tr key={row.id} className={rowClass}>
                        <td className="p-6 text-center text-slate-300 hover:text-red-500 cursor-pointer font-black" onClick={() => {
                          setModal({show: true, type: 'SOFT_DELETE', title: 'Move to Recycle Bin?', value: "", extra: "", role: "user", editId: null, targetId: row.id, targetSheetId: activeSheetId});
                        }}>✖</td>
                        
                        <td className="p-6"><input value={row.project} onChange={e => setSheets(sheets.map(s => s.id === activeSheetId ? {...s, rows: s.rows.map(r => r.id === row.id ? {...r, project: e.target.value} : r)} : s))} className="bg-transparent font-bold outline-none w-full border-b border-transparent focus:border-blue-400"/></td>

                        <td className="p-6 border-l border-slate-50 min-w-37.5 bg-blue-50/10">
                          <div className="flex flex-col gap-2">
                            <input type="date" value={row.startDate || ""} onChange={e => setSheets(sheets.map(s => s.id === activeSheetId ? {...s, rows: s.rows.map(r => r.id === row.id ? {...r, startDate: e.target.value} : r)} : s))} className="text-xs bg-blue-100/50 rounded-md px-2 py-1 outline-none text-slate-700 font-medium w-full"/>
                            {!row.hasStarted ? (
                              <button onClick={() => {
                                  if(!row.startDate) return alert("Please select a Start Date first.");
                                  
                                  // 1. Send "project started" notification
                                  const msg = `This is a message from the MoF, Bhutan. ${row.project} has started, now you will be receiving the notification of this from now on.`;
                                  getRowRecipients(row, emailCols).forEach(({ address, role }) =>
                                    triggerEmail(address, row.project, msg, {
                                      role,
                                      sheetId: activeSheet?.id,
                                      rowId: row.id,
                                      baseUrl: appBaseUrl
                                    })
                                  );

                                  // 2. Send due date reminder emails for each due column that has a date set
                                  dueTypes.forEach(col => {
                                    const dueDate = row.dueDates?.[col.id];
                                    if (!dueDate) return;
                                    const today = new Date();
                                    today.setHours(0, 0, 0, 0);
                                    const due = new Date(dueDate);
                                    due.setHours(0, 0, 0, 0);
                                    const daysLeft = Math.round((due - today) / (1000 * 60 * 60 * 24));
                                    const shouldSend = col.reminderDays?.some(d => d === daysLeft) || daysLeft <= 0;
                                    if (shouldSend) {
                                      const dueMsg = daysLeft <= 0
                                        ? `REMINDER: ${col.title} for ${row.project} is DUE TODAY or OVERDUE (${dueDate}).`
                                        : `REMINDER: ${col.title} for ${row.project} is due in ${daysLeft} day(s) on ${dueDate}.`;
                                      getRowRecipients(row, emailCols).forEach(({ address, role }) =>
                                        triggerEmail(address, row.project, dueMsg, {
                                          role,
                                          sheetId: activeSheet?.id,
                                          rowId: row.id,
                                          colId: col.id,
                                          isReport: false,
                                          baseUrl: appBaseUrl
                                        })
                                      );
                                    }
                                  });

                                  // 3. Send report due date reminder emails for each report column that has a date set
                                  reportCols.forEach(col => {
                                    const repDate = row.reportDates?.[col.id];
                                    if (!repDate) return;
                                    const today = new Date();
                                    today.setHours(0, 0, 0, 0);
                                    const due = new Date(repDate);
                                    due.setHours(0, 0, 0, 0);
                                    const daysLeft = Math.round((due - today) / (1000 * 60 * 60 * 24));
                                    const shouldSend = col.reminderDays?.some(d => d === daysLeft) || daysLeft <= 0;
                                    if (shouldSend) {
                                      const repMsg = daysLeft <= 0
                                        ? `REMINDER: Report "${col.title}" for ${row.project} is DUE TODAY or OVERDUE (${repDate}).`
                                        : `REMINDER: Report "${col.title}" for ${row.project} is due in ${daysLeft} day(s) on ${repDate}.`;
                                      getRowRecipients(row, emailCols).forEach(({ address, role }) =>
                                        triggerEmail(address, row.project, repMsg, {
                                          role,
                                          sheetId: activeSheet?.id,
                                          rowId: row.id,
                                          colId: col.id,
                                          isReport: true,
                                          baseUrl: appBaseUrl
                                        })
                                      );
                                    }
                                  });

                                  setSheets(sheets.map(s => s.id === activeSheetId ? {...s, rows: s.rows.map(r => r.id === row.id ? {...r, hasStarted: true} : r)} : s));
                                }} className="w-full py-2 rounded-lg text-[8px] font-black tracking-widest border transition-all bg-blue-500 text-white border-blue-600 hover:bg-blue-600 shadow-sm">START PROJECT</button>
                            ) : (
                              <div className="w-full py-2 rounded-lg text-[8px] font-black tracking-widest border transition-all bg-slate-200 text-slate-500 text-center cursor-not-allowed border-slate-300">NOTIFIED</div>
                            )}
                          </div>
                        </td>

                        {emailCols.map(col => {
                          const emailString = row.emails?.[col.id] || "";
                          const emailsList = emailString.split(",").map(e => e.trim()).filter(Boolean);

                          return (
                            <td key={col.id} className="p-3 border-l border-slate-50 align-top">
                              <div className="flex flex-col gap-2 bg-sky-50/50 border border-sky-100 rounded-lg p-2 focus-within:ring-2 focus-within:ring-sky-400 transition-all shadow-sm min-w-[200px] max-w-[250px]">
                                
                                {/* Render Each Email as a Stacked Row */}
                                {emailsList.length > 0 && (
                                  <div className="flex flex-col gap-1.5">
                                    {emailsList.map((em, idx) => (
                                      <div key={idx} className="flex items-center justify-between bg-white border border-sky-200 text-sky-700 text-[10px] font-bold px-2 py-1.5 rounded shadow-sm w-full">
                                        <span className="truncate mr-2">{em}</span>
                                        <button 
                                          onClick={() => {
                                            const newEmails = emailsList.filter((_, i) => i !== idx).join(", ");
                                            setSheets(sheets.map(s => s.id === activeSheetId ? {
                                              ...s, rows: s.rows.map(r => r.id === row.id ? { ...r, emails: { ...(r.emails || {}), [col.id]: newEmails } } : r)
                                            } : s));
                                          }}
                                          className="text-slate-400 hover:text-red-500 font-black shrink-0 focus:outline-none transition-colors text-xs"
                                          title="Remove email"
                                        >
                                          ×
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Input to type new email */}
                                <div className="flex items-center gap-2 mt-1">
                                  <div className="flex items-center justify-center w-6 h-6 bg-sky-100 text-sky-500 font-black rounded text-sm shrink-0">
                                    @
                                  </div>
                                  <input
                                    type="text"
                                    placeholder={emailsList.length === 0 ? "Add email..." : "Add another..."}
                                    className="flex-1 bg-transparent border-none outline-none text-xs font-semibold text-slate-700 w-full placeholder-sky-300"
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === ",") {
                                        e.preventDefault();
                                        const newEmail = e.currentTarget.value.trim();
                                        if (newEmail) {
                                          const newEmailsString = emailsList.length > 0 ? `${emailString}, ${newEmail}` : newEmail;
                                          setSheets(sheets.map(s => s.id === activeSheetId ? {
                                            ...s, rows: s.rows.map(r => r.id === row.id ? { ...r, emails: { ...(r.emails || {}), [col.id]: newEmailsString } } : r)
                                          } : s));
                                          e.currentTarget.value = "";
                                        }
                                      }
                                    }}
                                    onBlur={(e) => {
                                      const newEmail = e.currentTarget.value.trim();
                                      if (newEmail) {
                                        const newEmailsString = emailsList.length > 0 ? `${emailString}, ${newEmail}` : newEmail;
                                        setSheets(sheets.map(s => s.id === activeSheetId ? {
                                          ...s, rows: s.rows.map(r => r.id === row.id ? { ...r, emails: { ...(r.emails || {}), [col.id]: newEmailsString } } : r)
                                        } : s));
                                        e.currentTarget.value = "";
                                      }
                                    }}
                                  />
                                </div>
                                
                              </div>
                            </td>
                          );
                        })}

                        {dueTypes.map(col => {
                          const status = row.statuses?.[col.id] || "Pending";
                          return (
                            <td key={col.id} className="p-6 border-l border-slate-50 min-w-37.5">
                              <div className="flex flex-col gap-2">
                                <input type="date" value={row.dueDates?.[col.id] || ""} onChange={e => setSheets(sheets.map(s => s.id === activeSheetId ? {...s, rows: s.rows.map(r => r.id === row.id ? {...r, dueDates: {...r.dueDates, [col.id]: e.target.value}} : r)} : s))} className="text-xs bg-slate-100 rounded-md px-2 py-1 outline-none text-slate-600 font-medium w-full"/>
                                <button onClick={() => {
                                    const next = status === "Pending" ? "Cleared" : "Pending";
                                    setSheets(sheets.map(s => s.id === activeSheetId ? {...s, rows: s.rows.map(r => r.id === row.id ? {...r, statuses: {...r.statuses, [col.id]: next}} : r)} : s));
                                    logActivity(row.project, `Marked ${col.title} as ${next}`);
                                    if(next === "Cleared") getRowRecipients(row, emailCols).forEach(({ address, role }) =>
                                      triggerEmail(address, row.project, `${col.title} CLEARED`, {
                                        role,
                                        sheetId: activeSheet?.id,
                                        rowId: row.id,
                                        colId: col.id,
                                        isReport: false,
                                        baseUrl: appBaseUrl
                                      })
                                    );
                                  }} className={`w-full py-2 rounded-lg text-[9px] font-black tracking-widest border transition-all ${status === 'Cleared' ? 'bg-green-500 text-white border-green-600' : 'bg-white text-red-500 border-red-100'}`}>
                                  {status.toUpperCase()}
                                </button>
                              </div>
                            </td>
                          );
                        })}

                        {reportCols.map(col => {
                          const status = row.reportStatuses?.[col.id] || "Pending";
                          return (
                            <td key={col.id} className="p-6 border-l border-slate-50 min-w-37.5 bg-indigo-50/10">
                              <div className="flex flex-col gap-2">
                                <input type="date" value={row.reportDates?.[col.id] || ""} onChange={e => setSheets(sheets.map(s => s.id === activeSheetId ? {...s, rows: s.rows.map(r => r.id === row.id ? {...r, reportDates: {...r.reportDates, [col.id]: e.target.value}} : r)} : s))} className="text-xs bg-indigo-100/50 rounded-md px-2 py-1 outline-none text-slate-600 font-medium w-full"/>
                                <button onClick={() => {
                                    const next = status === "Pending" ? "Cleared" : "Pending";
                                    setSheets(sheets.map(s => s.id === activeSheetId ? {...s, rows: s.rows.map(r => r.id === row.id ? {...r, reportStatuses: {...r.reportStatuses, [col.id]: next}} : r)} : s));
                                    logActivity(row.project, `Marked ${col.title} as ${next}`);
                                    if(next === "Cleared") {
                                      const stopMsg = `${row.project} notification will stop from now on / will not receive.`;
                                      getRowRecipients(row, emailCols).forEach(({ address, role }) =>
                                        triggerEmail(address, row.project, stopMsg, {
                                          role,
                                          sheetId: activeSheet?.id,
                                          rowId: row.id,
                                          colId: col.id,
                                          isReport: true,
                                          baseUrl: appBaseUrl
                                        })
                                      );
                                    }
                                  }} className={`w-full py-2 rounded-lg text-[9px] font-black tracking-widest border transition-all ${status === 'Cleared' ? 'bg-indigo-500 text-white border-indigo-600' : 'bg-white text-indigo-500 border-indigo-200 shadow-sm'}`}>
                                  {status === "Cleared" ? "SUBMITTED" : "PENDING"}
                                </button>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* RECYCLE BIN VIEW */}
        {view === "archive" && (
          <div className="flex flex-col h-full bg-slate-50 p-8">
             <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-black text-slate-800">Recycle Bin</h1>
                <p className="text-slate-500 font-bold text-sm">Recover or permanently delete projects</p>
             </div>
             <div className="flex-1 overflow-auto bg-white rounded-2xl shadow-sm border border-slate-100">
               <table className="w-full text-left border-collapse">
                 <thead className="bg-slate-50 border-b border-slate-100 text-slate-400 font-black text-[10px] uppercase tracking-widest">
                   <tr>
                     <th className="p-5">Tracker</th>
                     <th className="p-5">Project Name</th>
                     <th className="p-5 text-right">Actions</th>
                   </tr>
                 </thead>
                 <tbody>
                   {sheets.map(sheet => 
                     (sheet.rows?.filter(r => r.isDeleted) || []).map(row => (
                       <tr key={`${sheet.id}-${row.id}`} className="border-b border-slate-50 hover:bg-slate-50 transition">
                         <td className="p-5 font-bold text-slate-500">{sheet.name}</td>
                         <td className="p-5 font-bold text-slate-800">{row.project || "Unnamed Project"}</td>
                         <td className="p-5 flex justify-end gap-3">
                           <button onClick={(e) => {
                             e.stopPropagation();
                             setSheets(sheets.map(s => s.id === sheet.id ? {...s, rows: s.rows.map(r => r.id === row.id ? {...r, isDeleted: false} : r)} : s));
                             logActivity(row.project, "Restored from Recycle Bin");
                           }} className="bg-green-100 text-green-700 px-5 py-2.5 rounded-xl font-black text-xs hover:bg-green-200 transition shadow-sm">
                              RESTORE
                           </button>
                           <button onClick={(e) => {
                             e.stopPropagation();
                             setModal({show: true, type: 'PERM_DELETE', title: 'Permanently Delete?', value: "", extra: "", role: "user", editId: null, targetId: row.id, targetSheetId: sheet.id});
                           }} className="bg-red-50 text-red-500 px-5 py-2.5 rounded-xl font-bold text-xs hover:bg-red-100 transition">
                              PERMANENT DELETE
                           </button>
                         </td>
                       </tr>
                     ))
                   )}
                 </tbody>
               </table>
             </div>
          </div>
        )}

        {/* VIEW: AUDIT LOG */}
        {view === "history" && (
          <div className="bg-white p-10 rounded-[2.5rem] shadow-xl border border-slate-100">
             <h2 className="text-2xl font-black mb-8">System Activity</h2>
             <table className="w-full text-left">
               <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                 <tr><th className="p-5">Time</th><th className="p-5">User</th><th className="p-5">Project</th><th className="p-5">Action Message</th></tr>
               </thead>
               <tbody>
                 {history.map((h, i) => (
                   <tr key={i} className="border-b border-slate-50 text-sm hover:bg-slate-50 transition">
                     <td className="p-5 text-slate-400 font-mono text-xs">{h.timestamp}</td>
                     <td className="p-5 font-bold text-blue-600">{h.user}</td>
                     <td className="p-5 font-bold">{h.project}</td>
                     <td className="p-5 font-medium text-slate-500">{h.type}</td>
                   </tr>
                 ))}
               </tbody>
             </table>
          </div>
        )}
      </main>
    </div>
  );
}
