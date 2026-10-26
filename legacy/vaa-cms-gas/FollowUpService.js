// ══════════════════════════════════════════════════
// FollowUpService.gs
// ══════════════════════════════════════════════════

function _fuGetSheet(ss)  { return ss.getSheetByName(CONFIG.SHEETS.FOLLOW_UPS); }
function _fuHMap(hRow)    { var h={}; hRow.forEach(function(c,i){if(c)h[String(c)]=i;}); return h; }
function _fuNextId(ss) {
  var sh=_fuGetSheet(ss); if(!sh) return 'FU-001';
  var d=sh.getDataRange().getValues(),ids=[];
  for(var i=1;i<d.length;i++){var v=String(d[i][0]||'');if(v.startsWith('FU-'))ids.push(parseInt(v.slice(3),10)||0);}
  return 'FU-'+String((ids.length?Math.max.apply(null,ids):0)+1).padStart(3,'0');
}
function _sdFu(v){return v instanceof Date?v.toISOString():String(v||'');}
function _toDFu(v){if(v instanceof Date)return v;if(v){var d=new Date(v);return isNaN(d.getTime())?null:d;}return null;}

function _mapFuRow(r, h) {
  function g(k){return h[k]!==undefined?String(r[h[k]]||''):''; }
  return {
    followUpId:      g('FollowUpID'),
    customerId:      g('CustomerID'),
    clientId:        g('ClientID'),
    subject:         g('Subject'),
    description:     g('Description'),
    dueDate:         _sdFu(r[h['DueDate']]),
    remindDaysBefore:parseInt(g('RemindDaysBefore'))||7,
    status:          g('Status')||'Open',
    assignedTo:      g('AssignedTo'),
    createdAt:       _sdFu(r[h['CreatedAt']]),
    createdBy:       g('CreatedBy'),
    updatedAt:       _sdFu(r[h['UpdatedAt']]),
    updatedBy:       g('UpdatedBy')
  };
}

function getFollowUps(filters) {
  try {
    filters=filters||{};
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var sh=_fuGetSheet(ss); if(!sh) return {success:true,data:[]};
    var d=sh.getDataRange().getValues(); if(d.length<2) return {success:true,data:[]};
    var h=_fuHMap(d[0]);
    // Name lookups
    var custMap={}, cliMap={};
    try {
      var cust=ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
      if(cust){var cd=cust.getDataRange().getValues(),ch=_fuHMap(cd[0]);
        for(var k=1;k<cd.length;k++){var cuid=String(cd[k][ch['CustomerID']]||'');if(cuid)custMap[cuid]=String(cd[k][ch['CustomerName']]||cuid);}}
      var cli=ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
      if(cli){var clid=cli.getDataRange().getValues(),clih=_fuHMap(clid[0]);
        for(var m=1;m<clid.length;m++){var clm=String(clid[m][clih['ClientID']]||'');
          if(clm)cliMap[clm]=(String(clid[m][clih['CompanyName']]||'')+(clid[m][clih['AccountName']]?' — '+clid[m][clih['AccountName']]:'')).trim();}}
    } catch(e2){}
    var out=[];
    for(var i=1;i<d.length;i++){
      if(!d[i][0]) continue;
      var rec=_mapFuRow(d[i],h);
      if(filters.customerId && rec.customerId !== filters.customerId) continue;
      if(filters.clientId   && rec.clientId   !== filters.clientId)   continue;
      if(filters.assignedTo && rec.assignedTo !== filters.assignedTo) continue;
      if(filters.status     && rec.status     !== filters.status)     continue;
      rec.customerName = custMap[rec.customerId] || rec.customerId;
      rec.clientName   = cliMap[rec.clientId]   || rec.clientId;
      out.push(rec);
    }
    return {success:true,data:out};
  } catch(e){ return {success:false,error:'getFollowUps: '+e.message}; }
}

function createFollowUp(payload) {
  try {
    var perm=checkPermission('edit'); if(!perm.allowed) return {success:false,error:'Permission denied.'};
    var permUser=perm.user&&perm.user.email?perm.user.email:(perm.user&&perm.user.name?perm.user.name:'system');
    if(!payload.subject) return {success:false,error:'Subject is required.'};
    if(!payload.dueDate)  return {success:false,error:'Due date is required.'};
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    _ensureSheet(ss, CONFIG.SHEETS.FOLLOW_UPS, CONFIG.SCHEMA.FollowUps);
    var sh=_fuGetSheet(ss);
    var h=_fuHMap(sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0]);
    var id=_fuNextId(ss), now=new Date();
    var row=new Array(sh.getLastColumn()).fill('');
    function s(k,v){if(h[k]!==undefined)row[h[k]]=v;}
    s('FollowUpID',      id);
    s('CustomerID',      payload.customerId||'');
    s('ClientID',        payload.clientId||'');
    s('Subject',         payload.subject);
    s('Description',     payload.description||'');
    s('DueDate',         _parseDateInput(payload.dueDate));
    s('RemindDaysBefore',parseInt(payload.remindDaysBefore)||7);
    s('Status',          'Open');
    s('AssignedTo',      payload.assignedTo||permUser);
    s('CreatedAt',       payload.createdAt ? _parseDateInput(payload.createdAt) : now);
    s('CreatedBy',       permUser);
    sh.appendRow(row);
    _logActivity('CREATE','FollowUp',id,'','',permUser);
    return {success:true,followUpId:id};
  } catch(e){ return {success:false,error:'createFollowUp: '+e.message}; }
}

function updateFollowUp(followUpId, payload) {
  try {
    var perm=checkPermission('edit'); if(!perm.allowed) return {success:false,error:'Permission denied.'};
    var permUser=perm.user&&perm.user.email?perm.user.email:(perm.user&&perm.user.name?perm.user.name:'system');
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var sh=_fuGetSheet(ss); if(!sh) return {success:false,error:'FollowUps sheet missing.'};
    var d=sh.getDataRange().getValues(), h=_fuHMap(d[0]);
    for(var i=1;i<d.length;i++){
      if(String(d[i][h['FollowUpID']]||'')!==followUpId) continue;
      var now=new Date();
      function su(k,v){if(h[k]!==undefined)sh.getRange(i+1,h[k]+1).setValue(v);}
      if(payload.subject)         su('Subject',payload.subject);
      if(payload.description!==undefined) su('Description',payload.description);
      if(payload.dueDate)         su('DueDate',_parseDateInput(payload.dueDate));
      if(payload.remindDaysBefore!==undefined) su('RemindDaysBefore',payload.remindDaysBefore);
      if(payload.status)          su('Status',payload.status);
      if(payload.assignedTo)      su('AssignedTo',payload.assignedTo);
      su('UpdatedAt',now); su('UpdatedBy',permUser);
      return {success:true};
    }
    return {success:false,error:'Follow-up not found.'};
  } catch(e){ return {success:false,error:'updateFollowUp: '+e.message}; }
}

// Upcoming follow-ups for dashboard reminder (within remindDaysBefore of due date)
function getUpcomingFollowUps(assignedTo) {
  try {
    var all=getFollowUps({status:'Open',assignedTo:assignedTo||''});
    if(!all.success) return all;
    var now=new Date();
    var upcoming=all.data.filter(function(f){
      var due=_toDFu(f.dueDate);
      if(!due) return false;
      var daysLeft=Math.ceil((due-now)/(1000*60*60*24));
      return daysLeft<=f.remindDaysBefore && daysLeft>=-7; // also show up to 7 days overdue
    });
    upcoming.sort(function(a,b){return new Date(a.dueDate)-new Date(b.dueDate);});
    return {success:true,data:upcoming};
  } catch(e){ return {success:false,error:'getUpcomingFollowUps: '+e.message}; }
}