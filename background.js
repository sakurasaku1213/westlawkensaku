/**
 * background.js (最終調整版)
 * テキスト解析機能を強化し、裁判所名から地名部分のみを抽出し
 * フリーワード検索欄に入力する機能を追加。
 * 全角数字を半角に自動変換する機能を追加し、日付認識の精度を向上。
 * 値入力後にchangeイベントを発火させ、ページに値の変更を認識させる。
 * ★【最終調整】末尾の「判決」などの単語を削除し、裁判所名の略称をより正確に処理するよう改良。
 */

// 拡張機能がインストールされたときに右クリックメニューを作成
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "searchWestlaw",
    title: "Westlawで検索",
    contexts: ["selection"]
  });
});

/**
 * Westlawのページ内で実行されるメインの処理関数。
 * テキストを解析し、各フィールドに入力して検索を実行します。
 * @param {string} selectedText - ユーザーが選択した生のテキスト。
 */
function advancedSearchOnPage(selectedText) {
  // --- 内部ヘルパー：テキスト解析ロジック ---
  const parseInfo = (text) => {
    // 解析前に全角英数字を半角に変換する
    const normalizedText = text.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => {
        return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
    });

    const ERA_VALUE_MAP = { '令和': '236', '平成': '235', '昭和': '234', '大正': '233', '明治': '232' };
    const ERA_ALIAS_MAP = { 'R': '令和', 'H': '平成', 'S': '昭和', 'T': '大正', 'M': '明治', '令': '令和', '平': '平成', '昭': '昭和', '大': '大正', '明': '明治' };
    
    let remainingText = normalizedText.replace(/　/g, ' ').trim();
    const result = { date: null, caseNumber: null, keyword: '' };

    // 1. 日付を解析
    const datePattern = new RegExp(
      `(${Object.keys(ERA_ALIAS_MAP).join('|')}|${Object.keys(ERA_VALUE_MAP).join('|')})` +
      `\\s*(\\d+|元)` + `\\s*[年./・－]\\s*` + `(\\d{1,2})` +
      `\\s*[月./・－]\\s*` + `(\\d{1,2})` + `\\s*日?`, 'i'
    );
    const dateMatch = remainingText.match(datePattern);
    if (dateMatch) {
      const eraAlias = dateMatch[1].toUpperCase();
      const normalizedEra = ERA_ALIAS_MAP[eraAlias] || eraAlias;
      result.date = {
        era: ERA_VALUE_MAP[normalizedEra],
        year: dateMatch[2], month: dateMatch[3], day: dateMatch[4]
      };
      remainingText = remainingText.replace(dateMatch[0], '').trim();
    }
    
    // 2. 事件番号を解析
    const caseNumPattern = new RegExp(
      `(?:(令|平|昭|大|明))` + `\\s*(\\d+|元)\\s*年` +
      `\\s*\\(\\s*([^\\s()]+)\\s*\\)` + `\\s*(?:第\\s*)?(\\d+)\\s*号`, 'i'
    );
    const caseNumMatch = remainingText.match(caseNumPattern);
    if (caseNumMatch) {
      result.caseNumber = {
        era: caseNumMatch[1], year: caseNumMatch[2],
        symbol: caseNumMatch[3], number: caseNumMatch[4]
      };
      remainingText = remainingText.replace(caseNumMatch[0], '').trim();
    }
    
    // 3. 残りのテキストから地名キーワードを抽出
    let keyword = remainingText;

    // ステップA: 末尾の「判決」「決定」などの単語を削除
    const legalTrailerWords = ['判決', '決定', '命令'];
    const trailerRegex = new RegExp(`(${legalTrailerWords.join('|')})$`);
    keyword = keyword.replace(trailerRegex, '').trim();

    // ステップB: 裁判所名から地名を抽出
    const courtSuffixes = [
        '地方裁判所', '高等裁判所', '家庭裁判所', '簡易裁判所',
        '地裁', '高裁', '家裁', '簡裁'
    ];
    // 長いものから先に一致させるためにソート
    courtSuffixes.sort((a, b) => b.length - a.length);
    for (const suffix of courtSuffixes) {
        if (keyword.endsWith(suffix)) {
            keyword = keyword.substring(0, keyword.length - suffix.length);
            break; // 最初に見つかったもので終了
        }
    }
    
    result.keyword = keyword;
    
    return result;
  };
  
  // 値を設定し、changeイベントを発火させるヘルパー関数
  const setValueAndDispatchEvent = (elementId, value) => {
    const element = document.getElementById(elementId);
    if (element) {
        element.value = value;
        const event = new Event('change', { bubbles: true });
        element.dispatchEvent(event);
    }
  };


  // --- メインのDOM操作ロジック ---
  const searchInfo = parseInfo(selectedText);

  // 日付フィールドに入力
  if (searchInfo.date) {
    setValueAndDispatchEvent('ddlJudEra', searchInfo.date.era);
    setValueAndDispatchEvent('ddlJudYear_flexselect', searchInfo.date.year);
    setValueAndDispatchEvent('ddlJudMonth_flexselect', searchInfo.date.month);
    setValueAndDispatchEvent('ddlJudDay_flexselect', searchInfo.date.day);
    // 元の隠れたselectの値も念のため設定
    setValueAndDispatchEvent('ddlJudYear', searchInfo.date.year);
    setValueAndDispatchEvent('ddlJudMonth', searchInfo.date.month);
    setValueAndDispatchEvent('ddlJudDay', searchInfo.date.day);
  }
  
  // 事件番号フィールドに入力
  if (searchInfo.caseNumber) {
    setValueAndDispatchEvent('ddlCaseNumEra', searchInfo.caseNumber.era);
    setValueAndDispatchEvent('ddlCaseNumYear_flexselect', searchInfo.caseNumber.year);
    setValueAndDispatchEvent('ddlCaseNumYear', searchInfo.caseNumber.year);
    setValueAndDispatchEvent('fldCourtId', searchInfo.caseNumber.symbol);
    setValueAndDispatchEvent('fldCaseNum', searchInfo.caseNumber.number);
  }
  
  // フリーワード欄に、解析・抽出したキーワードを入力
  const keywordInput = document.getElementById('ft');
  if (keywordInput) {
    if (searchInfo.keyword) {
      keywordInput.value = searchInfo.keyword;
    } else if (!searchInfo.date && !searchInfo.caseNumber) {
      keywordInput.value = selectedText;
    }
  }

  // 検索ボタンをクリック
  const searchButton = document.getElementById('submitSearch');
  if (searchButton) {
    searchButton.click();
  }
}

// 右クリックメニューがクリックされたときに実行される処理
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "searchWestlaw" && info.selectionText) {
    const blankSearchPageUrl = 'https://go.westlawjapan.com/wljp/app/search/template?tid=wljpCasesSearchTemplate&clean=true';
    const newTab = await chrome.tabs.create({ url: blankSearchPageUrl });

    const listener = (tabId, changeInfo) => {
      if (tabId === newTab.id && changeInfo.status === 'complete') {
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          function: advancedSearchOnPage,
          args: [info.selectionText]
        });
        chrome.tabs.onUpdated.removeListener(listener);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  }
});
