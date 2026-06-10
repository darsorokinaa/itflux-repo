import { JSDOM } from 'jsdom';
import fs from 'fs';
const dom = new JSDOM();
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;

import { formatEgeInf2TruthTableHtml } from './frontend/src/utils/formatEgeInf2TaskHtml.js';

const html = `<table>
<tbody><tr><td> <p>Миша заполнял таблицу истинности функции</p> <p>(¬<i><span>x</span></i>/\¬<i><span>y</span></i>)\/ (<i><span>y</span></i>≡<i>z</i>)\/<span> <i>w</i></span>,</p> <p>но успел заполнить лишь фрагмент из трёх различных её строк, даже не указав, какому столбцу таблицы соответствует каждая из переменных <i>w</i>,<i> x</i>,<i> y</i>,<i> z</i>.</p> <table> <tbody><tr>     <td> <p><b>(¬</b><b><i><span>x</span></i></b><b>/\</b><b>¬</b><b><i><span>y</span></i>)\/ </b><b>(</b><b><i><span>y</span></i></b><b>≡<i>z</i>)</b><b>\/</b><b><span> <i>w</i></span></b></p> </td> </tr> <tr>   <td> <p><span>1</span></p> </td>  <td> <p><b>0</b></p> </td> </tr> <tr> <td> <p>1</p> </td> <td> <p>0</p> </td>  <td> <p><span>1</span></p> </td> <td> <p><b>0</b></p> </td> </tr> <tr> <td> <p><span>0</span></p> </td> <td> <p><span>0</span></p> </td> <td> <p><span>1</span></p> </td> <td> <p><span>1</span></p> </td> <td> <p><b>0</b></p> </td> </tr> </tbody></table> <p>Определите, какому столбцу таблицы соответствует каждая из переменных <i>w</i>,<i> x</i>,<i> y</i>,<i> z</i>.</p> <p>В ответе напишите буквы <i>w</i>,<i> x</i>,<i> y</i>,<i> z</i> в том порядке, в котором идут соответствующие им столбцы (сначала буква, соответствующая первому столбцу; затем буква, соответствующая второму столбцу, и т.д.). Буквы в ответе пишите подряд, никаких разделителей между буквами ставить не нужно.</p> <p><i>Пример.</i> Функция задана выражением ¬<i><span>x</span></i>\/<span> <i>y</i></span>, зависящим от двух переменных, а фрагмент таблицы имеет следующий вид.</p> <div class="task-html-block"><p><b>¬</b><b><i><span>x</span></i></b><b>\/</b><b><span> <i>y</i></span></b></p></div><div class="task-html-block"><p>0</p></div><div class="task-html-block"><p>1</p></div><div class="task-html-block"><p><b>0</b></p></div> <p><span>В этом случае первому столбцу соответствует переменная <i>y</i>, а второму столбцу \\(–\\) переменная <i>x</i>. В ответе следует написать: <i>yx</i>.</span></p> </td></tr>
<tr><td>

</td></tr></tbody></table>`;

console.log(formatEgeInf2TruthTableHtml(html));
