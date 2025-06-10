/**
 * background.js (v2.0)
 * - 判例秘書の検索機能を追加。
 * - 右クリックメニューを検索サイトごとに表示するよう変更。
 * - 選択された検索サイトに応じて、適切なページで自動入力と検索を実行する。
 * ★【改良】判例秘書の検索ページがリダイレクトされる問題に対応するため、2段階ナビゲーションを実装。
 * ★【最終修正】メニューページのHTML構造を直接解析し、「判例検索」ボタンを正確にクリックするよう修正。
 */

// --- 右クリックメニューの作成 ---
chrome.runtime.onInstalled.addListener(() => {
  // 親メニューを作成
  chrome.contextMenus.create({
    id: "parent",
    title: "判例ワンクリック検索",
    contexts: ["selection"]
  });

  // Westlaw用のメニュー
  chrome.contextMenus.create({
    id: "searchWestlaw",
    parentId: "parent",
    title: "Westlawで検索",
    contexts: ["selection"]
  });

  // 判例秘書用のメニュー
  chrome.contextMenus.create({
    id: "searchHisho",
    parentId: "parent",
    title: "判例秘書で検索",
    contexts: ["selection"]
  });
});


// --- 共通の処理をまとめたヘルパー関数 ---

/**
 * 新しいタブを開き、読み込み完了後に指定されたスクリプトを実行する
 * @param {string} url - 開くページのURL
 * @param {function} funcToInject - ページに注入して実行する関数
 * @param {Array} args - 注入する関数に渡す引数の配列
 */
async function openTabAndExecuteScript(url, funcToInject, args) {
  const newTab = await chrome.tabs.create({ url: url });

  const listener = (tabId, changeInfo) => {
    if (tabId === newTab.id && changeInfo.status === 'complete') {
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        function: funcToInject,
        args: args
      });
      chrome.tabs.onUpdated.removeListener(listener);
    }
  };
  chrome.tabs.onUpdated.addListener(listener);
}


// --- 右クリックメニューがクリックされたときのメイン処理 ---

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info.selectionText) return;

  const selectedText = info.selectionText;

  switch (info.menuItemId) {
    case "searchWestlaw":
      openTabAndExecuteScript(
        'https://go.westlawjapan.com/wljp/app/search/template?tid=wljpCasesSearchTemplate&clean=true',
        advancedSearchOnWestlawPage,
        [selectedText]
      );
      break;
    
    case "searchHisho":
      const menuUrl = 'https://www.legal-info.com/net/menu';
      const searchUrl = 'https://www.legal-info.com/net/search';
      
      const newTab = await chrome.tabs.create({ url: menuUrl });

      const hishoNavigationListener = (tabId, changeInfo, tab) => {
        if (tabId !== newTab.id || changeInfo.status !== 'complete') {
          return;
        }

        if (tab.url.startsWith(menuUrl)) {
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: clickHanreiSearchButton
          });
        } 
        else if (tab.url.startsWith(searchUrl)) {
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: advancedSearchOnHishoPage,
            args: [selectedText]
          });
          chrome.tabs.onUpdated.removeListener(hishoNavigationListener);
        }
      };
      
      chrome.tabs.onUpdated.addListener(hishoNavigationListener);
      break;
  }
});


// ===================================================================
//  各検索サイトのページに注入されて実行される関数群
//  (自己完結しており、外部の変数や関数に依存しない)
// ===================================================================

/**
 * [注入用関数] Westlaw Japanのページで自動検索を実行
 * @param {string} selectedText - ユーザーが選択した生のテキスト
 */
function advancedSearchOnWestlawPage(selectedText) {
  const parseInfo = (text) => {
    const normalizedText = text.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
    const ERA_VALUE_MAP = { '令和': '236', '平成': '235', '昭和': '234', '大正': '233', '明治': '232' };
    const ERA_ALIAS_MAP = { 'R': '令和', 'H': '平成', 'S': '昭和', 'T': '大正', 'M': '明治', '令': '令和', '平': '平成', '昭': '昭和', '大': '大正', '明': '明治' };
    let remainingText = normalizedText.replace(/　/g, ' ').trim();
    const result = { date: null, caseNumber: null, keyword: '' };
    const datePattern = new RegExp(`(${Object.keys(ERA_ALIAS_MAP).join('|')}|${Object.keys(ERA_VALUE_MAP).join('|')})\\s*(\\d+|元)\\s*[年./・－]\\s*(\\d{1,2})\\s*[月./・－]\\s*(\\d{1,2})\\s*日?`, 'i');
    const dateMatch = remainingText.match(datePattern);
    if (dateMatch) {
      const eraAlias = dateMatch[1].toUpperCase();
      const normalizedEra = ERA_ALIAS_MAP[eraAlias] || eraAlias;
      result.date = { era: ERA_VALUE_MAP[normalizedEra], year: dateMatch[2], month: dateMatch[3], day: dateMatch[4] };
      remainingText = remainingText.replace(dateMatch[0], '').trim();
    }
    const caseNumPattern = new RegExp(`(?:(令|平|昭|大|明))\\s*(\\d+|元)\\s*年\\s*\\(\\s*([^\\s()]+)\\s*\\)\\s*(?:第\\s*)?(\\d+)\\s*号`, 'i');
    const caseNumMatch = remainingText.match(caseNumPattern);
    if (caseNumMatch) {
      result.caseNumber = { era: caseNumMatch[1], year: caseNumMatch[2], symbol: caseNumMatch[3], number: caseNumMatch[4] };
      remainingText = remainingText.replace(caseNumMatch[0], '').trim();
    }
    let keyword = remainingText.replace(/(判決|決定|命令)$/, '').trim();
    const courtSuffixes = ['地方裁判所', '高等裁判所', '家庭裁判所', '簡易裁判所', '地裁', '高裁', '家裁', '簡裁'];
    courtSuffixes.sort((a, b) => b.length - a.length);
    for (const suffix of courtSuffixes) {
      if (keyword.endsWith(suffix)) {
        keyword = keyword.substring(0, keyword.length - suffix.length);
        break;
      }
    }
    result.keyword = keyword;
    return result;
  };
  const setValueAndDispatchEvent = (elementId, value) => {
    const element = document.getElementById(elementId);
    if (element) {
      element.value = value;
      const event = new Event('change', { bubbles: true });
      element.dispatchEvent(event);
    }
  };
  const searchInfo = parseInfo(selectedText);
  if (searchInfo.date) {
    setValueAndDispatchEvent('ddlJudEra', searchInfo.date.era);
    setValueAndDispatchEvent('ddlJudYear_flexselect', searchInfo.date.year);
    setValueAndDispatchEvent('ddlJudMonth_flexselect', searchInfo.date.month);
    setValueAndDispatchEvent('ddlJudDay_flexselect', searchInfo.date.day);
    setValueAndDispatchEvent('ddlJudYear', searchInfo.date.year);
    setValueAndDispatchEvent('ddlJudMonth', searchInfo.date.month);
    setValueAndDispatchEvent('ddlJudDay', searchInfo.date.day);
  }
  if (searchInfo.caseNumber) {
    setValueAndDispatchEvent('ddlCaseNumEra', searchInfo.caseNumber.era);
    setValueAndDispatchEvent('ddlCaseNumYear_flexselect', searchInfo.caseNumber.year);
    setValueAndDispatchEvent('ddlCaseNumYear', searchInfo.caseNumber.year);
    setValueAndDispatchEvent('fldCourtId', searchInfo.caseNumber.symbol);
    setValueAndDispatchEvent('fldCaseNum', searchInfo.caseNumber.number);
  }
  const keywordInput = document.getElementById('ft');
  if (keywordInput) {
    if (searchInfo.keyword) keywordInput.value = searchInfo.keyword;
    else if (!searchInfo.date && !searchInfo.caseNumber) keywordInput.value = selectedText;
  }
  const searchButton = document.getElementById('submitSearch');
  if (searchButton) searchButton.click();
}


/**
 * ★[最終修正版・注入用関数] 判例秘書のメニューページで「判例検索」ボタンを探してクリックする
 */
function clickHanreiSearchButton() {
    // 判例秘書のメニューページのHTML構造に基づき、
    // 「判例検索」に相当するボタンを見つけてクリックします。
    // このボタンは<li id="basic_db-01">の中にあります。
    
    const searchButton = document.querySelector('#basic_db-01 button[type="submit"]');

    if (searchButton) {
        searchButton.click();
    } else {
        // ボタンが見つからなかった場合のエラーメッセージ
        console.error('[判例ワンクリック検索] エラー: 判例秘書のメニューページで「判例検索」ボタン(id: basic_db-01 内の button)が見つかりませんでした。');
    }
}


/**
 * [注入用関数] 判例秘書のページで自動検索を実行
 * @param {string} selectedText - ユーザーが選択した生のテキスト
 */
function advancedSearchOnHishoPage(selectedText) {
  const parseInfo = (text) => {
    const normalizedText = text.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
    const ERA_MAP = { '令和': 'R', '平成': 'H', '昭和': 'S', '西暦': 'G' };
    const ERA_ALIAS_MAP = { 'R': '令和', 'H': '平成', 'S': '昭和', 'T': '大正', 'M': '明治', '令': '令和', '平': '平成', '昭': '昭和', '大': '大正', '明': '明治' };
    let remainingText = normalizedText.replace(/　/g, ' ').trim();
    const result = { date: null, caseNumber: null, courtName: '' };
    const datePattern = new RegExp(`(${Object.keys(ERA_ALIAS_MAP).join('|')}|令和|平成|昭和|西暦)\\s*(\\d+|元)\\s*[年./・－]\\s*(\\d{1,2})\\s*[月./・－]\\s*(\\d{1,2})\\s*日?`, 'i');
    const dateMatch = remainingText.match(datePattern);
    if (dateMatch) {
        const eraAlias = dateMatch[1].toUpperCase();
        const normalizedEra = ERA_ALIAS_MAP[eraAlias] || eraAlias;
        result.date = { era: ERA_MAP[normalizedEra], year: dateMatch[2] === '元' ? 1 : dateMatch[2], month: dateMatch[3], day: dateMatch[4] };
        remainingText = remainingText.replace(dateMatch[0], '').trim();
    }
    const caseNumPattern = new RegExp(`(?:(令|平|昭|大|明))\\s*(\\d+|元)\\s*年\\s*\\(\\s*([^\\s()]+)\\s*\\)\\s*(?:第\\s*)?(\\d+)\\s*号`, 'i');
    const caseNumMatch = remainingText.match(caseNumPattern);
    if (caseNumMatch) {
      const normalizedEra = ERA_ALIAS_MAP[caseNumMatch[1]];
      result.caseNumber = { era: ERA_MAP[normalizedEra], year: caseNumMatch[2] === '元' ? 1 : caseNumMatch[2], symbol: caseNumMatch[3], number: caseNumMatch[4] };
      remainingText = remainingText.replace(caseNumMatch[0], '').trim();
    }
    result.courtName = remainingText.replace(/(判決|決定|命令)$/, '').trim();
    return result;
  };

  const setValueByName = (name, value) => {
    const element = document.querySelector(`[name="${name}"]`);
    if (element && value) {
      element.value = value;
    }
  };

  const searchInfo = parseInfo(selectedText);
  
  if (searchInfo.courtName) {
    setValueByName('C1', searchInfo.courtName);
  }
  if (searchInfo.date) {
    setValueByName('T11', searchInfo.date.era);
    setValueByName('T12', searchInfo.date.year);
    setValueByName('T13', searchInfo.date.month);
    setValueByName('T14', searchInfo.date.day);
  }
  if (searchInfo.caseNumber) {
    setValueByName('CN1', searchInfo.caseNumber.era);
    setValueByName('CN2', searchInfo.caseNumber.year);
    setValueByName('CN3', searchInfo.caseNumber.symbol);
    setValueByName('CN4', searchInfo.caseNumber.number);
  }

  const searchButton = document.getElementById('searchbtn');
  if (searchButton) {
    searchButton.click();
  }
}
