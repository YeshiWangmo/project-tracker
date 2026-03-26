// --- INITIAL LOAD WITH SAFEGUARDS & ID SYNC FIX ---
  useEffect(() => {
    const fetchData = async () => {
      try {
        const resSheets = await fetch("/api/tracker", { cache: 'no-store' });
        const dbSheets = await resSheets.json();
        
        let sheetsToLoad = [];
        if (Array.isArray(dbSheets) && dbSheets.length > 0) {
          sheetsToLoad = dbSheets;
        } else {
          sheetsToLoad = [createDefaultSheet()];
        }
        setSheets(sheetsToLoad);

        const savedActiveId = localStorage.getItem("tracker-active-id");
        const parsedId = savedActiveId ? JSON.parse(savedActiveId) : null;
        
        if (parsedId && sheetsToLoad.some(s => s.id === parsedId)) {
          setActiveSheetId(parsedId);
        } else {
          setActiveSheetId(sheetsToLoad[0].id);
        }

        const resUsers = await fetch("/api/users", { cache: 'no-store' });
        const dbUsers = await resUsers.json();
        if (Array.isArray(dbUsers) && dbUsers.length > 0) setUsers(dbUsers);
        else setUsers([{ id: 1, username: "admin", password: "password123", role: "admin" }]);

        const resHistory = await fetch("/api/history", { cache: 'no-store' });
        const dbHistory = await resHistory.json();
        if (Array.isArray(dbHistory) && dbHistory.length > 0) setHistory(dbHistory);

      } catch (error) {
        console.error("Failed to fetch from DB:", error);
        const fallbackSheet = createDefaultSheet();
        setSheets([fallbackSheet]); 
        setActiveSheetId(fallbackSheet.id);
      }
      
      setIsLoaded(true);
    };
    
    fetchData();
  }, []);

  // --- SAVE ALL DATA TO CLOUD ---
  useEffect(() => {
    if (isLoaded) {
      const saveTimer = setTimeout(async () => {
        try {
          await fetch("/api/tracker", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sheets) });
          await fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(users) });
          
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
  }, [sheets, activeSheetId, history, users, isLoaded]);

  const activeSheet = sheets.find(s => s.id === activeSheetId) || sheets[0];
  const rows = activeSheet?.rows || [];
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

  const handleLogin = (e) => {
    e.preventDefault();
    const user = users.find(u => u.username === loginForm.username && u.password === loginForm.password);
    if (user) { setIsLoggedIn(true); setCurrentUser(user); } else { alert("Invalid Credentials"); }
  };

  const triggerEmail = async (emailAddr, project, type) => {
    if (!emailAddr || !emailAddr.includes("@")) return;
    try {
      await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: emailAddr, project, sheetName: activeSheet?.name || "Tracker", type })
      });
      setHistory(prev => [{
        id: Date.now(), recipient: emailAddr, project, type,
        timestamp: new Date().toLocaleString(), user: currentUser?.username || "System Auto"
      }, ...prev]);
    } catch (e) { console.error(e); }
  };

  // --- BULLETPROOF REMINDER SCANNER ---
  const runDailyReminders = useCallback((isAutoRun = false) => {
    let emailsSent = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const safeSheets = Array.isArray(sheets) ? sheets : [];

    safeSheets.forEach(sheet => {
      const safeRows = Array.isArray(sheet.rows) ? sheet.rows : [];
      
      safeRows.forEach(row => {
        const emailsToNotify = Object.values(row.emails || {});
        if (emailsToNotify.length === 0) return;

        (sheet.dueTypes || []).forEach(col => {
          if (row.statuses?.[col.id] === "Cleared" || !row.dueDates?.[col.id]) return;
          const dueDate = new Date(row.dueDates[col.id]);
          dueDate.setHours(0, 0, 0, 0);
          const diffDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24)); 
          const schedule = col.reminderDays || [30, 17, 7, 3];

          if (schedule.includes(diffDays)) {
            emailsToNotify.forEach(emailAddr => {
              triggerEmail(emailAddr, row.project, `${col.title} - ${diffDays} DAY REMINDER`);
              emailsSent++;
            });
          }
        });

        (sheet.reportCols || []).forEach(col => {
          if (row.reportStatuses?.[col.id] === "Cleared" || !row.reportDates?.[col.id]) return;
          const reportDate = new Date(row.reportDates[col.id]);
          reportDate.setHours(0, 0, 0, 0);
          const diffDays = Math.ceil((reportDate - today) / (1000 * 60 * 60 * 24)); 
          const schedule = col.reminderDays || [30, 17, 7, 3];

          if (schedule.includes(diffDays)) {
            const formattedDate = reportDate.toISOString().split('T')[0];
            const customMessage = `${row.project} report ${col.title} submission is on ${formattedDate} as of for now ${diffDays} days have remain`;
            
            emailsToNotify.forEach(emailAddr => {
              triggerEmail(emailAddr, row.project, customMessage);
              emailsSent++;
            });
          }
        });
      });
    });

    if (!isAutoRun) {
      alert(`✅ Scan Complete! Sent ${emailsSent} automatic reminders.`);
    }
  }, [sheets, triggerEmail]);

  useEffect(() => {
    if (isLoaded && isLoggedIn) {
      const todayStr = new Date().toDateString();
      const lastRun = localStorage.getItem("tracker-last-run");
      
      if (lastRun !== todayStr) {
        console.log("Running daily background reminders...");
        runDailyReminders(true); 
        localStorage.setItem("tracker-last-run", todayStr);
      }
    }
  }, [isLoaded, isLoggedIn, runDailyReminders]);

  const confirmModal = () => {
    if (modal.type === "RENAME_SHEET") setSheets(sheets.map(s => s.id === activeSheetId ? { ...s, name: modal.value } : s));
    if (modal.type === "ADD_USER") setUsers([...users, { id: Date.now(), username: modal.value, password: modal.extra, role: modal.role || "user" }]);
    if (modal.type === "EDIT_USER") setUsers(users.map(u => u.id === modal.editId ? { ...u, username: modal.value, password: modal.extra, role: modal.role } : u));
    if (modal.type === "DELETE_SHEET") {
      const remaining = sheets.filter(s => s.id !== activeSheetId);
      if (remaining.length > 0) { setSheets(remaining); setActiveSheetId(remaining[0].id); }
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
      let days = [30, 17, 7, 3];
      let sName = "Default (30,17,7,3)";
      if (modal.extra === "weekly") { days = [7]; sName = "Weekly"; }
      if (modal.extra === "monthly") { days = [30]; sName = "Monthly"; }
      if (modal.extra === "quarterly") { days = [90]; sName = "Quarterly"; }
      if (modal.extra === "semi") { days = [180]; sName = "Semi-Annually"; }
      if (modal.extra === "annually") { days = [365]; sName = "Annually"; }

      setSheets(sheets.map(s => {
        if (s.id === activeSheetId) {
          if (modal.type === "ADD_COLUMN") return {...s, dueTypes: [...s.dueTypes, { id: Date.now(), title: modal.value || "Phase", reminderDays: days, scheduleName: sName }]};
          else return {...s, reportCols: [...(s.reportCols || []), { id: Date.now(), title: modal.value || "Report", reminderDays: days, scheduleName: sName }]};
        }
        return s;
      }));
    }
    setModal({ show: false, type: "", title: "", value: "", extra: "", role: "user", editId: null });
  };

  if (!isLoaded) return null;

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f172a] p-6">
        <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl w-full max-w-md">
          <h1 className="text-4xl font-black text-center mb-8 text-slate-900 tracking-tighter">AdminHub</h1>
          <form onSubmit={handleLogin} className="space-y-4">
            <input type="text" placeholder="Username" className="w-full bg-slate-50 border-none rounded-2xl px-5 py-4 outline-none focus:ring-2 focus:ring-blue-500 font-medium" value={loginForm.username} onChange={e => setLoginForm({...loginForm, username: e.target.value})}/>
            <input type="password" placeholder="Password" className="w-full bg-slate-50 border-none rounded-2xl px-5 py-4 outline-none focus:ring-2 focus:ring-blue-500 font-medium" value={loginForm.password} onChange={e => setLoginForm({...loginForm, password: e.target.value})}/>
            <button className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl shadow-lg hover:bg-blue-700 transition transform active:scale-95">Sign In</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-[#f8fafc] text-slate-900">
      {/* MODAL */}
      {modal.show && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-4xl p-8 w-full max-w-sm shadow-2xl">
            <h3 className="text-xl font-black mb-4">{modal.title}</h3>
            <input placeholder="Type here..." className="w-full bg-slate-50 p-4 rounded-xl outline-none border border-slate-100 mb-4 font-bold" value={modal.value} onChange={e => setModal({...modal, value: e.target.value})}/>
            
            {(modal.type === "ADD_USER" || modal.type === "EDIT_USER") && (
              <>
                <input placeholder="Password" type="text" className="w-full bg-slate-50 p-4 rounded-xl outline-none border border-slate-100 mb-4" value={modal.extra} onChange={e => setModal({...modal, extra: e.target.value})}/>
                <select className="w-full bg-slate-50 p-4 rounded-xl outline-none border border-slate-100 mb-4 font-bold text-sm" value={modal.role || "user"} onChange={e => setModal({...modal, role: e.target.value})}>
                  <option value="user">Basic User</option>
                  <option value="admin">Admin (Full Access)</option>
                </select>
              </>
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
              <button onClick={() => setModal({show:false})} className="flex-1 py-3 font-bold text-slate-400">Cancel</button>
              <button onClick={confirmModal} className="flex-1 py-3 rounded-xl font-bold text-white bg-blue-600">Confirm</button>
            </div>
          </div>
        </div>
      )}

      <aside className="w-64 bg-[#0f172a] text-white p-8 flex flex-col gap-3">
        <div className="text-2xl font-black mb-8 text-blue-500 tracking-tighter">AdminHub</div>
        
        <button onClick={() => runDailyReminders(false)} className="bg-green-500 hover:bg-green-400 text-white font-black py-3 px-4 rounded-xl mb-6 shadow-lg shadow-green-900/50 transition transform active:scale-95 flex items-center gap-2 text-sm justify-center">
          🔔 Force Scan Now
        </button>

        <button onClick={() => setView("dashboard")} className={`text-left px-5 py-3.5 rounded-2xl font-bold transition ${view === 'dashboard' ? 'bg-blue-600 shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>📊 Dashboard</button>
        <button onClick={() => setView("history")} className={`text-left px-5 py-3.5 rounded-2xl font-bold transition ${view === 'history' ? 'bg-blue-600 shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>📜 Audit Log</button>
        {currentUser?.role === 'admin' && <button onClick={() => setView("users")} className={`text-left px-5 py-3.5 rounded-2xl font-bold transition ${view === 'users' ? 'bg-blue-600 shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>👥 Users</button>}
        
        <button onClick={() => setIsLoggedIn(false)} className="mt-auto text-xs font-bold text-red-400 px-5">Logout</button>
      </aside>

      <main className="flex-1 p-10 overflow-auto">
        {view === "dashboard" && (
          <>
            <div className="grid grid-cols-3 gap-6 mb-10">
              <div onClick={() => setHighlightMode(highlightMode === 'Pending' ? null : 'Pending')} className={`p-8 rounded-4xl border-2 cursor-pointer transition-all shadow-sm ${highlightMode === 'Pending' ? 'bg-red-50 border-red-500 ring-4 ring-red-100 scale-105' : 'bg-white border-transparent'}`}>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Pending Projects</p>
                <h2 className="text-4xl font-black text-red-500">{pendingProjects}</h2>
              </div>
              <div onClick={() => setHighlightMode(highlightMode === 'Cleared' ? null : 'Cleared')} className={`p-8 rounded-4xl border-2 cursor-pointer transition-all shadow-sm ${highlightMode === 'Cleared' ? 'bg-green-50 border-green-500 ring-4 ring-green-100 scale-105' : 'bg-white border-transparent'}`}>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Cleared Projects</p>
                <h2 className="text-4xl font-black text-green-500">{clearedProjects}</h2>
              </div>
              <div className="p-8 rounded-4xl bg-slate-900 text-white shadow-xl">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Total Projects</p>
                <h2 className="text-4xl font-black text-blue-400">{totalProjects}</h2>
              </div>
            </div>

            <div className="flex justify-between items-center mb-8">
               <div className="flex gap-4 items-center">
                  <select value={activeSheetId || ""} onChange={e => setActiveSheetId(Number(e.target.value))} className="bg-white font-bold rounded-xl px-4 py-2 shadow-sm border-none outline-none">
                    {sheets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <button onClick={() => setModal({show:true, type:'RENAME_SHEET', title:'Rename Sheet', value:activeSheet?.name})} className="text-xs font-bold text-blue-500">Rename</button>
                  <button onClick={() => setModal({show:true, type:'DELETE_SHEET', title:'Delete Sheet'})} className="text-xs font-bold text-red-500">Delete Sheet</button>
                  <button onClick={() => setModal({show:true, type:'ADD_SHEET', title:'New Sheet Name', value:'New Tracker'})} className="text-xs font-bold text-green-500">+ New Sheet</button>
               </div>
               <div className="flex gap-2">
              
    
                <button onClick={() => setSheets(sheets.map(s => s.id === activeSheetId ? {...s, rows: [...s.rows, {id:Date.now(), project: "New Project", emails:{}, startDate:"", hasStarted: false, statuses:{}, dueDates:{}, reportStatuses:{}, reportDates:{}}]} : s))} className="bg-white text-slate-700 border px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-slate-50">+ Row</button>
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
                      <th key={col.id} className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest border-l border-slate-100 group relative">
                        {col.title}
                        <button onClick={() => setSheets(sheets.map(s => s.id === activeSheetId ? {...s, emailCols: s.emailCols.filter(d => d.id !== col.id)} : s))} className="absolute top-1 right-1 hidden group-hover:block text-[8px] bg-red-100 text-red-600 px-1 rounded font-black cursor-pointer">DEL</button>
                        <div className={`text-[8px] mt-1 ${col.role === 'payer' ? 'text-amber-500' : 'text-sky-500'}`}>{col.role === 'payer' ? 'PAYER (ACTION)' : 'RECEIVER (INFO)'}</div>
                      </th>
                    ))}
                    
                    {dueTypes.map(col => (
                      <th key={col.id} className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest border-l border-slate-100 group relative">
                        Due: {col.title}
                        <button onClick={() => setSheets(sheets.map(s => s.id === activeSheetId ? {...s, dueTypes: s.dueTypes.filter(d => d.id !== col.id)} : s))} className="absolute top-1 right-1 hidden group-hover:block text-[8px] bg-red-100 text-red-600 px-1 rounded font-black cursor-pointer">DEL</button>
                        <div className="text-[8px] text-blue-500 mt-1">{col.scheduleName || "Default"}</div>
                      </th>
                    ))}

                    {reportCols.map(col => (
                      <th key={col.id} className="p-6 text-[10px] font-black text-indigo-500 uppercase tracking-widest border-l border-slate-100 bg-indigo-50/30 group relative">
                        Report: {col.title}
                        <button onClick={() => setSheets(sheets.map(s => s.id === activeSheetId ? {...s, reportCols: s.reportCols.filter(d => d.id !== col.id)} : s))} className="absolute top-1 right-1 hidden group-hover:block text-[8px] bg-red-100 text-red-600 px-1 rounded font-black cursor-pointer">DEL</button>
                        <div className="text-[8px] text-indigo-400 mt-1">{col.scheduleName || "Default"}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isDuesCleared = dueTypes.every(dt => row.statuses?.[dt.id] === "Cleared");
                    const isReportsCleared = reportCols.every(rc => row.reportStatuses?.[rc.id] === "Cleared");
                    const projectIsCleared = (dueTypes.length > 0 || reportCols.length > 0) && isDuesCleared && isReportsCleared;
                    const rowHighlight = (highlightMode === 'Pending' && !projectIsCleared) || (highlightMode === 'Cleared' && projectIsCleared);

                    return (
                      <tr key={row.id} className={`border-b border-slate-50 transition-all ${rowHighlight ? (projectIsCleared ? 'bg-green-50/50' : 'bg-red-50/50') : 'hover:bg-slate-50/30'}`}>
                        <td className="p-6 text-center text-slate-300 hover:text-red-500 cursor-pointer font-black" onClick={() => setSheets(sheets.map(s => s.id === activeSheetId ? {...s, rows: s.rows.filter(r => r.id !== row.id)} : s))}>✖</td>
                        
                        <td className="p-6"><input value={row.project} onChange={e => setSheets(sheets.map(s => s.id === activeSheetId ? {...s, rows: s.rows.map(r => r.id === row.id ? {...r, project: e.target.value} : r)} : s))} className="bg-transparent font-bold outline-none w-full border-b border-transparent focus:border-blue-400"/></td>

                        <td className="p-6 border-l border-slate-50 min-w-37.5 bg-blue-50/10">
                          <div className="flex flex-col gap-2">
                            <input type="date" value={row.startDate || ""} onChange={e => setSheets(sheets.map(s => s.id === activeSheetId ? {...s, rows: s.rows.map(r => r.id === row.id ? {...r, startDate: e.target.value} : r)} : s))} className="text-xs bg-blue-100/50 rounded-md px-2 py-1 outline-none text-slate-700 font-medium w-full"/>
                            {!row.hasStarted ? (
                              <button onClick={() => {
                                  if(!row.startDate) return alert("Please select a Start Date first.");
                                  const formattedDate = new Date(row.startDate).toISOString().split('T')[0];
                                  const msg = `${row.project} has been started on ${formattedDate} now u will receive the notification for this one`;
                                  Object.values(row.emails || {}).forEach(em => triggerEmail(em, row.project, msg));
                                  setSheets(sheets.map(s => s.id === activeSheetId ? {...s, rows: s.rows.map(r => r.id === row.id ? {...r, hasStarted: true} : r)} : s));
                                }} className="w-full py-2 rounded-lg text-[8px] font-black tracking-widest border transition-all bg-blue-500 text-white border-blue-600 hover:bg-blue-600 shadow-sm">START PROJECT</button>
                            ) : (
                              <div className="w-full py-2 rounded-lg text-[8px] font-black tracking-widest border transition-all bg-slate-200 text-slate-500 text-center cursor-not-allowed border-slate-300">NOTIFIED</div>
                            )}
                          </div>
                        </td>

                        {emailCols.map(col => (
                          <td key={col.id} className="p-6 border-l border-slate-50">
                            <input placeholder="email@test.com" value={row.emails?.[col.id] || ""} onChange={e => setSheets(sheets.map(s => s.id === activeSheetId ? {...s, rows: s.rows.map(r => r.id === row.id ? {...r, emails: {...r.emails, [col.id]: e.target.value}} : r)} : s))} className="bg-transparent outline-none w-full text-xs font-medium text-slate-600"/>
                          </td>
                        ))}

                        {dueTypes.map(col => {
                          const status = row.statuses?.[col.id] || "Pending";
                          return (
                            <td key={col.id} className="p-6 border-l border-slate-50 min-w-37.5">
                              <div className="flex flex-col gap-2">
                                <input type="date" value={row.dueDates?.[col.id] || ""} onChange={e => setSheets(sheets.map(s => s.id === activeSheetId ? {...s, rows: s.rows.map(r => r.id === row.id ? {...r, dueDates: {...r.dueDates, [col.id]: e.target.value}} : r)} : s))} className="text-xs bg-slate-100 rounded-md px-2 py-1 outline-none text-slate-600 font-medium w-full"/>
                                <button onClick={() => {
                                    const next = status === "Pending" ? "Cleared" : "Pending";
                                    setSheets(sheets.map(s => s.id === activeSheetId ? {...s, rows: s.rows.map(r => r.id === row.id ? {...r, statuses: {...r.statuses, [col.id]: next}} : r)} : s));
                                    if(next === "Cleared") Object.values(row.emails || {}).forEach(em => triggerEmail(em, row.project, `${col.title} CLEARED`));
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
                                    if(next === "Cleared") Object.values(row.emails || {}).forEach(em => triggerEmail(em, row.project, `REPORT ${col.title} SUBMITTED`));
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

        {/* VIEW: USER MANAGEMENT */}
        {view === "users" && (
          <div className="bg-white p-10 rounded-[2.5rem] shadow-xl border border-slate-100 max-w-4xl mx-auto">
             <div className="flex justify-between items-center mb-8">
               <h2 className="text-2xl font-black">User Management</h2>
               <button onClick={() => setModal({show:true, type:'ADD_USER', title:'Add New User', value: '', extra: '', role: 'user'})} className="bg-blue-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm shadow-md hover:bg-blue-700 transition">+ Add User</button>
             </div>
             <div className="border border-slate-100 rounded-2xl overflow-hidden">
               <table className="w-full text-left">
                 <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                   <tr>
                     <th className="p-5">Username</th>
                     <th className="p-5">Password</th>
                     <th className="p-5">Role</th>
                     <th className="p-5 text-center">Action</th>
                   </tr>
                 </thead>
                 <tbody>
                   {users.map(u => (
                     <tr key={u.id || u.username} className="border-b border-slate-50 text-sm">
                       <td className="p-5 font-bold text-slate-800">{u.username}</td>
                       <td className="p-5 font-mono text-slate-400">{u.password}</td>
                       <td className="p-5">
                         <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${u.role === 'admin' ? 'bg-purple-100 text-purple-600' : 'bg-slate-100 text-slate-500'}`}>{u.role}</span>
                       </td>
                       <td className="p-5 text-center">
                         <button onClick={() => setModal({show:true, type:'EDIT_USER', title:'Edit User', value: u.username, extra: u.password, role: u.role, editId: u.id})} className="text-blue-500 font-bold text-xs hover:underline mr-4">Edit</button>
                         <button onClick={() => setUsers(users.filter(user => user.id !== u.id))} className="text-red-500 font-bold text-xs hover:underline">Delete</button>
                       </td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             </div>
          </div>
        )}
      </main>
    </div>
  );
