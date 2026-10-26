// ══════════════════════════════════════════════════════════
// ContractService.gs — Dynamic sections-based Contracts
// ══════════════════════════════════════════════════════════

function _contGetSheet(ss)      { return ss.getSheetByName(CONFIG.SHEETS.CONTRACTS); }
function _sdefGetSheet(ss)      { return ss.getSheetByName(CONFIG.SHEETS.CONTRACT_SECTION_DEFS); }
function _csecGetSheet(ss)      { return ss.getSheetByName(CONFIG.SHEETS.CONTRACT_SECTIONS); }
function _assignGetSheet(ss)    { return ss.getSheetByName(CONFIG.SHEETS.CONTRACT_ASSIGNMENTS); }
function _contHMap(hRow)        { var h={}; hRow.forEach(function(c,i){if(c)h[String(c)]=i;}); return h; }
// _sdC (Date → ISO string serializer) lives in ClientService.gs — shared
// across files, no need to redefine it here.
function _nextId(ss, sheet, prefix, padLen) {
  if(!sheet) return prefix+'-001';
  var d=sheet.getDataRange().getValues(), ids=[];
  for(var i=1;i<d.length;i++){var v=String(d[i][0]||'');if(v.startsWith(prefix+'-'))ids.push(parseInt(v.slice(prefix.length+1),10)||0);}
  return prefix+'-'+String((ids.length?Math.max.apply(null,ids):0)+1).padStart(padLen||3,'0');
}
function _permC() {
  var p=checkPermission('edit');
  return { allowed:p.allowed, user:p.user&&p.user.email?p.user.email:(p.user&&p.user.name?p.user.name:'system') };
}

// ─────────────────────────────────────────────
// CONTRACT SECTION DEFINITIONS (global settings)
// ─────────────────────────────────────────────

function getContractSectionDefs() {
  try {
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    _ensureSheet(ss, CONFIG.SHEETS.CONTRACT_SECTION_DEFS, CONFIG.SCHEMA.ContractSectionDefs);
    var sh=_sdefGetSheet(ss); if(!sh) return {success:true,data:[]};
    var d=sh.getDataRange().getValues(); if(d.length<2) return {success:true,data:[]};
    var h=_contHMap(d[0]);
    var out=[];
    for(var i=1;i<d.length;i++){
      if(!d[i][h['SectionDefID']]) continue;
      if(d[i][h['IsActive']]===false||d[i][h['IsActive']]==='false') continue;
      out.push({
        sectionDefId: String(d[i][h['SectionDefID']]||''),
        sectionName:  String(d[i][h['SectionName']] ||''),
        fieldType:    String(d[i][h['FieldType']]   ||'Text'),
        description:  String(d[i][h['Description']] ||''),
        sortOrder:    parseInt(d[i][h['SortOrder']]||'0')||0
      });
    }
    out.sort(function(a,b){return a.sortOrder-b.sortOrder;});
    return {success:true,data:out};
  } catch(e){return {success:false,error:'getContractSectionDefs: '+e.message};}
}

function createContractSectionDef(payload) {
  try {
    var p=_permC(); if(!p.allowed) return {success:false,error:'Permission denied.'};
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    _ensureSheet(ss, CONFIG.SHEETS.CONTRACT_SECTION_DEFS, CONFIG.SCHEMA.ContractSectionDefs);
    var sh=_sdefGetSheet(ss);
    var h=_contHMap(sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0]);
    var id=_nextId(ss, sh, 'SDF', 3);
    var row=new Array(sh.getLastColumn()).fill('');
    function s(k,v){if(h[k]!==undefined)row[h[k]]=v;}
    s('SectionDefID',payload.sectionName.replace(/\s+/g,'-').toUpperCase().slice(0,8)+'-'+id.slice(-3));
    s('SectionName', payload.sectionName||'');
    s('FieldType',   payload.fieldType  ||'Text');
    s('Description', payload.description||'');
    s('SortOrder',   parseInt(payload.sortOrder)||0);
    s('IsActive',    true);
    s('CreatedAt',   new Date());
    s('CreatedBy',   p.user);
    sh.appendRow(row);
    return {success:true};
  } catch(e){return {success:false,error:'createContractSectionDef: '+e.message};}
}

function deleteContractSectionDef(sectionDefId) {
  try {
    var p=_permC(); if(!p.allowed) return {success:false,error:'Permission denied.'};
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var sh=_sdefGetSheet(ss); if(!sh) return {success:false,error:'Not found.'};
    var d=sh.getDataRange().getValues(), h=_contHMap(d[0]);
    for(var i=1;i<d.length;i++){
      if(String(d[i][h['SectionDefID']]||'')!==sectionDefId) continue;
      sh.getRange(i+1,h['IsActive']+1).setValue(false);
      return {success:true};
    }
    return {success:false,error:'Section def not found.'};
  } catch(e){return {success:false,error:'deleteContractSectionDef: '+e.message};}
}

// ─────────────────────────────────────────────
// CONTRACTS CRUD
// ─────────────────────────────────────────────

function getContracts() {
  try {
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    _ensureSheet(ss, CONFIG.SHEETS.CONTRACTS, CONFIG.SCHEMA.Contracts);
    var sh=_contGetSheet(ss); if(!sh) return {success:true,data:[]};
    var d=sh.getDataRange().getValues(); if(d.length<2) return {success:true,data:[]};
    var h=_contHMap(d[0]);
    // Load section values
    var secVals={}; // contractId → [{sectionDefId, sectionName, fieldType, value}]
    try {
      var csv=_csecGetSheet(ss);
      if(csv&&csv.getLastRow()>1){
        var cd=csv.getDataRange().getValues(), ch=_contHMap(cd[0]);
        for(var ci=1;ci<cd.length;ci++){
          var cid=String(cd[ci][ch['ContractID']]||'');
          if(!cid) continue;
          if(!secVals[cid]) secVals[cid]=[];
          secVals[cid].push({
            sectionId:   String(cd[ci][ch['SectionID']]  ||''),
            sectionDefId:String(cd[ci][ch['SectionDefID']]||''),
            sectionName: String(cd[ci][ch['SectionName']] ||''),
            fieldType:   String(cd[ci][ch['FieldType']]   ||'Text'),
            value:       String(cd[ci][ch['Value']]       ||'')
          });
        }
      }
    } catch(se){}
    var out=[];
    for(var i=1;i<d.length;i++){
      if(!d[i][h['ContractID']]) continue;
      var cid2=String(d[i][h['ContractID']]||'');
      out.push({
        contractId:   cid2,
        contractName: String(d[i][h['ContractName']]||''),
        description:  String(d[i][h['Description']] ||''),
        period:       String(d[i][h['Period']]       ||'Annual'),
        isActive:     d[i][h['IsActive']]!==false&&String(d[i][h['IsActive']]||'true')!=='false',
        notes:        String(d[i][h['Notes']]        ||''),
        createdAt:    _sdC(d[i][h['CreatedAt']]),
        sections:     secVals[cid2]||[]
      });
    }
    return {success:true,data:out};
  } catch(e){return {success:false,error:'getContracts: '+e.message};}
}

// Lightweight contract list for dropdowns (Add Account, etc.) — returns just
// contractId/contractName/isActive without joining ContractSectionValues.
// getContracts() above does that join for the full Contracts page (where
// section data is actually shown), but pulling it just to populate a <select>
// was needlessly slow on accounts with many contract sections — sometimes
// slow enough that the dropdown looked stuck. Use this wherever only the
// name/id/active-flag is needed.
function getContractListLite() {
  try {
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    _ensureSheet(ss, CONFIG.SHEETS.CONTRACTS, CONFIG.SCHEMA.Contracts);
    var sh=_contGetSheet(ss); if(!sh) return {success:true,data:[]};
    var d=sh.getDataRange().getValues(); if(d.length<2) return {success:true,data:[]};
    var h=_contHMap(d[0]);
    var out=[];
    for(var i=1;i<d.length;i++){
      if(!d[i][h['ContractID']]) continue;
      out.push({
        contractId:   String(d[i][h['ContractID']]||''),
        contractName: String(d[i][h['ContractName']]||''),
        isActive:     d[i][h['IsActive']]!==false&&String(d[i][h['IsActive']]||'true')!=='false'
      });
    }
    return {success:true,data:out};
  } catch(e){return {success:false,error:'getContractListLite: '+e.message};}
}

function createContract(payload) {
  try {
    var p=_permC(); if(!p.allowed) return {success:false,error:'Permission denied.'};
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    _ensureSheet(ss, CONFIG.SHEETS.CONTRACTS, CONFIG.SCHEMA.Contracts);
    var sh=_contGetSheet(ss);
    var h=_contHMap(sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0]);
    var id=_nextId(ss, sh, 'CON', 3);
    var row=new Array(sh.getLastColumn()).fill('');
    function s(k,v){if(h[k]!==undefined)row[h[k]]=v;}
    s('ContractID',  id);
    s('ContractName',payload.contractName||'');
    s('Description', payload.description||'');
    s('Period',      payload.period||'Annual');
    s('IsActive',    true);
    s('Notes',       payload.notes||'');
    s('CreatedAt',   new Date()); s('CreatedBy',p.user);
    sh.appendRow(row);
    // Save section values
    if(payload.sections && payload.sections.length) {
      _saveContractSections(ss, id, payload.sections, p.user);
    }
    return {success:true,contractId:id};
  } catch(e){return {success:false,error:'createContract: '+e.message};}
}

function updateContract(contractId, payload) {
  try {
    var p=_permC(); if(!p.allowed) return {success:false,error:'Permission denied.'};
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var sh=_contGetSheet(ss); if(!sh) return {success:false,error:'Contracts sheet missing.'};
    var d=sh.getDataRange().getValues(), h=_contHMap(d[0]);
    for(var i=1;i<d.length;i++){
      if(String(d[i][h['ContractID']]||'')!==contractId) continue;
      function su(k,v){if(h[k]!==undefined)sh.getRange(i+1,h[k]+1).setValue(v);}
      su('ContractName',payload.contractName);
      su('Description', payload.description||'');
      su('Period',      payload.period||'Annual');
      su('Notes',       payload.notes||'');
      su('UpdatedAt',   new Date()); su('UpdatedBy',p.user);
      if(payload.sections) _saveContractSections(ss, contractId, payload.sections, p.user);
      return {success:true};
    }
    return {success:false,error:'Contract not found.'};
  } catch(e){return {success:false,error:'updateContract: '+e.message};}
}

function _saveContractSections(ss, contractId, sections, user) {
  _ensureSheet(ss, CONFIG.SHEETS.CONTRACT_SECTIONS, CONFIG.SCHEMA.ContractSections);
  var sh=_csecGetSheet(ss); if(!sh) return;
  var h=_contHMap(sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0]);
  var now=new Date();
  // Delete existing rows for this contract
  var d=sh.getDataRange().getValues();
  for(var i=d.length-1;i>=1;i--){
    if(String(d[i][h['ContractID']]||'')===contractId) sh.deleteRow(i+1);
  }
  // Append new ones
  sections.forEach(function(sec){
    var row=new Array(sh.getLastColumn()).fill('');
    function s(k,v){if(h[k]!==undefined)row[h[k]]=v;}
    s('SectionID',   'SEC-'+contractId+'-'+sec.sectionDefId);
    s('ContractID',  contractId);
    s('SectionDefID',sec.sectionDefId||'');
    s('SectionName', sec.sectionName||'');
    s('FieldType',   sec.fieldType||'Text');
    s('Value',       sec.value||'');
    s('UpdatedAt',   now); s('UpdatedBy',user);
    sh.appendRow(row);
  });
}

// ─────────────────────────────────────────────
// CONTRACT ASSIGNMENTS
// ─────────────────────────────────────────────

function getContractAssignments() {
  try {
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    _ensureSheet(ss, CONFIG.SHEETS.CONTRACT_ASSIGNMENTS, CONFIG.SCHEMA.ContractAssignments);
    var sh=_assignGetSheet(ss); if(!sh) return {success:true,data:[]};
    var d=sh.getDataRange().getValues(); if(d.length<2) return {success:true,data:[]};
    var h=_contHMap(d[0]);
    var contMap={};
    try{var cs=_contGetSheet(ss);if(cs){var cd=cs.getDataRange().getValues(),ch=_contHMap(cd[0]);for(var ci=1;ci<cd.length;ci++){var cid=String(cd[ci][ch['ContractID']]||'');if(cid)contMap[cid]=String(cd[ci][ch['ContractName']]||cid);}}}catch(e){}
    var custMap={}, cliMap={};
    try{
      var cu=ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);if(cu){var cud=cu.getDataRange().getValues(),cuh=_contHMap(cud[0]);for(var k=1;k<cud.length;k++){var kk=String(cud[k][cuh['CustomerID']]||'');if(kk)custMap[kk]=String(cud[k][cuh['CustomerName']]||kk);}}
      var cl=ss.getSheetByName(CONFIG.SHEETS.CLIENTS);if(cl){var cld=cl.getDataRange().getValues(),clh=_contHMap(cld[0]);for(var m=1;m<cld.length;m++){var mm=String(cld[m][clh['ClientID']]||'');if(mm)cliMap[mm]=(String(cld[m][clh['CompanyName']]||'')+(cld[m][clh['AccountName']]?' — '+cld[m][clh['AccountName']]:'')).trim();}}
    }catch(e2){}
    var out=[];
    for(var i=1;i<d.length;i++){
      if(!d[i][h['AssignmentID']]) continue;
      var eid=String(d[i][h['EntityID']]||''),etype=String(d[i][h['EntityType']]||'');
      out.push({assignmentId:String(d[i][h['AssignmentID']]||''),contractId:String(d[i][h['ContractID']]||''),
        contractName:contMap[String(d[i][h['ContractID']]||'')] ||'',
        entityType:etype,entityId:eid,
        entityName:etype==='Customer'?custMap[eid]:cliMap[eid]||eid,
        assignedAt:_sdC(d[i][h['AssignedAt']]),assignedBy:String(d[i][h['AssignedBy']]||''),
        notes:String(d[i][h['Notes']]||'')});
    }
    return {success:true,data:out};
  } catch(e){return {success:false,error:'getContractAssignments: '+e.message};}
}

// The Contracts module's own list of who's on which contract — built
// directly from the Accounts (Clients) tab's own ContractID field,
// which is the field the Add/Edit Account form's Contract dropdown
// actually writes to (see f_contractId in scripts-core.html). This is
// NOT the same data as getContractAssignments() above: that reads a
// separate ContractAssignments log, created only through the
// module's own "+ Assign Contract" button, which can drift out of
// sync with whatever's actually set on the account itself. Every
// account shows up here — including ones with no contract assigned
// yet (contractId comes back '') — since the point is to see the
// Accounts tab's real, current state, not just a history of explicit
// assignment actions.
function getAccountsWithContracts() {
  try {
    var clientsRes = getClients({});
    if (!clientsRes.success) return clientsRes;

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var contractNameById = {};
    try {
      var contSheet = _contGetSheet(ss);
      if (contSheet) {
        var contData = contSheet.getDataRange().getValues();
        var contH = _contHMap(contData[0]);
        for (var ci = 1; ci < contData.length; ci++) {
          var cid = String(contData[ci][contH['ContractID']]||''); if (!cid) continue;
          contractNameById[cid] = String(contData[ci][contH['ContractName']]||cid);
        }
      }
    } catch (contEx) { Logger.log('getAccountsWithContracts contract lookup: ' + contEx.message); }

    // Real bug fixed here: getClients()'s own customerName comes from a
    // CACHED CustomerName column on the Clients sheet itself, which
    // isn't reliably backfilled for every row (older/bulk-imported
    // accounts in particular) — getClients() has no fallback for it, so
    // a blank cache silently showed the customer ID instead of their
    // name. Built as a live lookup against the Customers sheet here,
    // the same pattern getClients() already uses one line above for
    // assignedSpecialist — and preferred over the cached value, not
    // just used when it's blank, since the Customers sheet is the
    // actual source of truth for a customer's name.
    var customerNameById = {};
    try {
      var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
      if (custSheet) {
        var custData = custSheet.getDataRange().getValues();
        var custH = {}; custData[0].forEach(function(c,i){ if(c) custH[String(c)]=i; });
        for (var cui = 1; cui < custData.length; cui++) {
          var cuid = String(custData[cui][custH['CustomerID']]||''); if (!cuid) continue;
          customerNameById[cuid] = String(custData[cui][custH['CustomerName']]||'');
        }
      }
    } catch (custEx) { Logger.log('getAccountsWithContracts customer name lookup: ' + custEx.message); }

    var out = clientsRes.data.map(function(c) {
      return {
        clientId:     c.clientId,
        customerId:   c.customerId,
        customerName: customerNameById[c.customerId] || c.customerName || '',
        companyName:  c.companyName,
        accountName:  c.accountName,
        status:       c.status,
        contractId:   c.contractId || '',
        contractName: c.contractId ? (contractNameById[c.contractId] || c.contractId) : ''
      };
    });
    return { success: true, data: out };
  } catch (e) {
    return { success: false, error: 'getAccountsWithContracts: ' + e.message };
  }
}

function assignContract(contractId, entityType, entityId, notes) {
  try {
    var p=_permC(); if(!p.allowed) return {success:false,error:'Permission denied.'};
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    _ensureSheet(ss, CONFIG.SHEETS.CONTRACT_ASSIGNMENTS, CONFIG.SCHEMA.ContractAssignments);
    var sh=_assignGetSheet(ss);
    var h=_contHMap(sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0]);
    var row=new Array(sh.getLastColumn()).fill('');
    function s(k,v){if(h[k]!==undefined)row[h[k]]=v;}
    s('AssignmentID','ASN-'+new Date().getTime());
    s('ContractID',contractId);s('EntityType',entityType);s('EntityID',entityId);
    s('AssignedAt',new Date());s('AssignedBy',p.user);s('Notes',notes||'');
    sh.appendRow(row);
    return {success:true};
  } catch(e){return {success:false,error:'assignContract: '+e.message};}
}