// Interactive chess board with morse code display
(function() {
  // Morse code lookup
  var MORSE = {
    'a':'.-','b':'-...','c':'-.-.','d':'-..','e':'.','f':'..-.','g':'--.','h':'....',
    'i':'..','j':'.---','k':'-.-','l':'.-..','m':'--','n':'-.','o':'---','p':'.--.',
    'q':'--.-','r':'.-.','s':'...','t':'-','u':'..-','v':'...-','w':'.--','x':'-..-',
    'y':'-.--','z':'--..','1':'.----','2':'..---','3':'...--','4':'....-','5':'.....',
    '6':'-....','7':'--...','8':'---..','9':'----.','0':'-----',
    '+':'.-.-.','#':'----','=':'-...-','x':'-..-'
  };

  function toMorse(str) {
    return str.toLowerCase().split('').map(function(c) {
      return MORSE[c] || c;
    }).join(' ');
  }

  // Piece unicode
  var PIECES = {
    'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
    'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟'
  };

  var PIECE_NAMES = { 'P':'','N':'N','B':'B','R':'R','Q':'Q','K':'K',
                      'p':'','n':'N','b':'B','r':'R','q':'Q','k':'K' };

  function initChessWidget() {
    var container = document.querySelector('.vnp-chess-widget');
    if (!container || container.dataset.init) return;
    container.dataset.init = '1';

    // Initial board state (standard starting position)
    var board = [
      ['r','n','b','q','k','b','n','r'],
      ['p','p','p','p','p','p','p','p'],
      ['' ,'' ,'' ,'' ,'' ,'' ,'' ,'' ],
      ['' ,'' ,'' ,'' ,'' ,'' ,'' ,'' ],
      ['' ,'' ,'' ,'' ,'' ,'' ,'' ,'' ],
      ['' ,'' ,'' ,'' ,'' ,'' ,'' ,'' ],
      ['P','P','P','P','P','P','P','P'],
      ['R','N','B','Q','K','B','N','R']
    ];

    var moves = [];
    var selected = null;
    var whiteToMove = true;

    var boardEl = container.querySelector('.vnp-board');
    var movesEl = container.querySelector('.vnp-moves-list');
    var resetBtn = container.querySelector('.vnp-reset-btn');

    function isWhite(piece) { return piece === piece.toUpperCase(); }

    function fileChar(col) { return String.fromCharCode(97 + col); }
    function rankChar(row) { return String(8 - row); }
    function sqName(row, col) { return fileChar(col) + rankChar(row); }

    function getNotation(piece, fromRow, fromCol, toRow, toCol, captured) {
      var name = PIECE_NAMES[piece];
      var cap = captured ? 'x' : '';
      // Pawn captures include file
      if (!name && captured) name = fileChar(fromCol);
      return name + cap + sqName(toRow, toCol);
    }

    function render() {
      boardEl.innerHTML = '';
      for (var r = 0; r < 8; r++) {
        for (var c = 0; c < 8; c++) {
          var sq = document.createElement('div');
          sq.className = 'vnp-square' + ((r + c) % 2 === 0 ? ' vnp-light' : ' vnp-dark');
          sq.dataset.row = r;
          sq.dataset.col = c;

          if (selected && selected.row === r && selected.col === c) {
            sq.classList.add('vnp-selected');
          }

          if (board[r][c]) {
            var p = document.createElement('span');
            p.className = 'vnp-piece' + (isWhite(board[r][c]) ? ' vnp-white-piece' : ' vnp-black-piece');
            p.textContent = PIECES[board[r][c]];
            sq.appendChild(p);
          }

          // File labels (bottom row)
          if (r === 7) {
            var fl = document.createElement('span');
            fl.className = 'vnp-file-label';
            fl.textContent = fileChar(c);
            sq.appendChild(fl);
          }
          // Rank labels (left column)
          if (c === 0) {
            var rl = document.createElement('span');
            rl.className = 'vnp-rank-label';
            rl.textContent = rankChar(r);
            sq.appendChild(rl);
          }

          sq.addEventListener('click', onSquareClick);
          boardEl.appendChild(sq);
        }
      }
    }

    function renderMoves() {
      movesEl.innerHTML = '';
      if (moves.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'vnp-moves-empty';
        empty.textContent = 'Make a move to see it in morse code';
        movesEl.appendChild(empty);
        return;
      }
      // Build move pairs (1. e4 e5 ...)
      for (var i = 0; i < moves.length; i++) {
        var entry = document.createElement('div');
        entry.className = 'vnp-move-entry';
        if (i === moves.length - 1) entry.classList.add('vnp-move-latest');

        var num = document.createElement('span');
        num.className = 'vnp-move-num';
        num.textContent = moves[i].number;

        var notation = document.createElement('span');
        notation.className = 'vnp-move-notation';
        notation.textContent = moves[i].notation;

        var morse = document.createElement('span');
        morse.className = 'vnp-move-morse';
        morse.textContent = moves[i].morse;

        entry.appendChild(num);
        entry.appendChild(notation);
        entry.appendChild(morse);
        movesEl.appendChild(entry);
      }
      // Scroll to bottom
      movesEl.scrollTop = movesEl.scrollHeight;
    }

    function onSquareClick(e) {
      var sq = e.currentTarget;
      var row = parseInt(sq.dataset.row);
      var col = parseInt(sq.dataset.col);
      var piece = board[row][col];

      if (selected) {
        var selPiece = board[selected.row][selected.col];
        // Clicking same square — deselect
        if (selected.row === row && selected.col === col) {
          selected = null;
          render();
          return;
        }
        // Clicking own piece — reselect
        if (piece && isWhite(piece) === isWhite(selPiece)) {
          selected = { row: row, col: col };
          render();
          return;
        }
        // Attempt move
        var captured = board[row][col];
        var notation = getNotation(selPiece, selected.row, selected.col, row, col, captured);
        var morseStr = toMorse(notation);

        var moveNum = '';
        if (whiteToMove) {
          moveNum = Math.floor(moves.length / 2 + 1) + '.';
        }

        board[row][col] = selPiece;
        board[selected.row][selected.col] = '';

        // Pawn promotion (auto-queen)
        if (selPiece === 'P' && row === 0) { board[row][col] = 'Q'; notation += '=Q'; morseStr = toMorse(notation); }
        if (selPiece === 'p' && row === 7) { board[row][col] = 'q'; notation += '=Q'; morseStr = toMorse(notation); }

        moves.push({ number: moveNum, notation: notation, morse: morseStr });
        whiteToMove = !whiteToMove;
        selected = null;
        render();
        renderMoves();
      } else {
        // Select piece if it's the right color
        if (piece && isWhite(piece) === whiteToMove) {
          selected = { row: row, col: col };
          render();
        }
      }
    }

    resetBtn.addEventListener('click', function() {
      board = [
        ['r','n','b','q','k','b','n','r'],
        ['p','p','p','p','p','p','p','p'],
        ['' ,'' ,'' ,'' ,'' ,'' ,'' ,'' ],
        ['' ,'' ,'' ,'' ,'' ,'' ,'' ,'' ],
        ['' ,'' ,'' ,'' ,'' ,'' ,'' ,'' ],
        ['' ,'' ,'' ,'' ,'' ,'' ,'' ,'' ],
        ['P','P','P','P','P','P','P','P'],
        ['R','N','B','Q','K','B','N','R']
      ];
      moves = [];
      selected = null;
      whiteToMove = true;
      render();
      renderMoves();
    });

    render();
    renderMoves();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChessWidget);
  } else {
    initChessWidget();
  }
  var sub = setInterval(function() {
    if (typeof document$ !== 'undefined') {
      clearInterval(sub);
      document$.subscribe(function() {
        var w = document.querySelector('.vnp-chess-widget');
        if (w) delete w.dataset.init;
        initChessWidget();
      });
    }
  }, 100);
})();
