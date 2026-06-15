// paiol — generate a sample interchange file (fictional confeitaria) for trying the app.
// Writes samples/exemplo-confeitaria.yaml. Load it via Ajustes → Importar dados.
// Run: node tools/make-sample.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { toYaml } from '../src/yaml-bridge.js';

const insumos = [
  { nome: 'Farinha de trigo', unidade: 'kg', preco: 5.5 },
  { nome: 'Açúcar', unidade: 'kg', preco: 4 },
  { nome: 'Ovos', unidade: 'un', preco: 0.7 },
  { nome: 'Leite', unidade: 'l', preco: 5 },
  { nome: 'Manteiga', unidade: 'kg', preco: 45 },
  { nome: 'Chocolate meio amargo', unidade: 'kg', preco: 38 },
  { nome: 'Cacau em pó', unidade: 'kg', preco: 60 },
  { nome: 'Fermento químico', unidade: 'kg', preco: 30 },
  { nome: 'Leite condensado', unidade: 'un', preco: 7.5 },
  { nome: 'Creme de leite', unidade: 'un', preco: 4 },
  { nome: 'Polvilho doce', unidade: 'kg', preco: 12 },
  { nome: 'Queijo', unidade: 'kg', preco: 40 },
  { nome: 'Bombom comprado', unidade: 'un', preco: 1.8 }, // finished item for the cesta
];

const item = (insumo, qtd, unidade) => ({ insumo, qtd, unidade });
const receitas = [
  { nome: 'Massa de bolo de chocolate', rende: 1, unidade: 'un', minutosAtivos: 25, minutosForno: 40, itens: [
    item('Farinha de trigo', 0.3, 'kg'), item('Açúcar', 0.25, 'kg'), item('Ovos', 3, 'un'),
    item('Cacau em pó', 0.08, 'kg'), item('Leite', 0.2, 'l'), item('Manteiga', 0.1, 'kg'),
    item('Fermento químico', 0.01, 'kg'),
  ] },
  { nome: 'Cobertura de chocolate', rende: 0.4, unidade: 'kg', minutosAtivos: 10, minutosForno: 0, itens: [
    item('Chocolate meio amargo', 0.2, 'kg'), item('Creme de leite', 1, 'un'), item('Leite condensado', 1, 'un'),
  ] },
  { nome: 'Brigadeiro', rende: 30, unidade: 'un', minutosAtivos: 20, minutosForno: 0, itens: [
    item('Leite condensado', 2, 'un'), item('Cacau em pó', 0.03, 'kg'), item('Manteiga', 0.02, 'kg'),
  ] },
  { nome: 'Pão de queijo', rende: 20, unidade: 'un', minutosAtivos: 30, minutosForno: 25, itens: [
    item('Polvilho doce', 0.5, 'kg'), item('Ovos', 2, 'un'), item('Leite', 0.1, 'l'),
    item('Queijo', 0.3, 'kg'), item('Manteiga', 0.05, 'kg'),
  ] },
];

const produtos = [
  { nome: 'Bolo de chocolate', embalagem: 2.5, descricaoEmbalagem: 'boleira', componentes: [
    { receita: 'Massa de bolo de chocolate', qtd: 1 }, { receita: 'Cobertura de chocolate', qtd: 0.4 },
  ] },
  { nome: 'Saco de pão de queijo', embalagem: 0.8, descricaoEmbalagem: 'pacote', componentes: [
    { receita: 'Pão de queijo', qtd: 10 },
  ] },
  { nome: 'Caixa de brigadeiro', embalagem: 1.5, descricaoEmbalagem: 'caixa', componentes: [
    { receita: 'Brigadeiro', qtd: 6 },
  ] },
  { nome: 'Brigadeiro avulso', embalagem: 0.2, descricaoEmbalagem: 'forminha', componentes: [
    { receita: 'Brigadeiro', qtd: 1 },
  ] },
  { nome: 'Cesta Festa', embalagem: 6, descricaoEmbalagem: 'caixa decorada', componentes: [
    { produto: 'Bolo de chocolate', qtd: 1 }, { produto: 'Caixa de brigadeiro', qtd: 1 },
    { insumo: 'Bombom comprado', qtd: 8 },
  ] },
];

const fornadas = [
  { receita: 'Pão de queijo', data: '2026-05-10', unidades: 18, minutosAtivos: 35 },
  { receita: 'Massa de bolo de chocolate', data: '2026-06-03', unidades: 1, minutosAtivos: 25 },
  { receita: 'Pão de queijo', data: '2026-06-07', unidades: 20, minutosAtivos: 30 },
  { receita: 'Brigadeiro', data: '2026-06-10', unidades: 30, minutosAtivos: 22 },
];

// Prices a bit above the suggested (under the default config) so the demo shows healthy profit.
const v = (produto, data, qtd, preco) => ({ produto, data, qtd, preco });
const vendas = [
  v('Bolo de chocolate', '2026-04-08', 1, 95), v('Saco de pão de queijo', '2026-04-12', 3, 34),
  v('Caixa de brigadeiro', '2026-04-20', 2, 14),
  v('Bolo de chocolate', '2026-05-05', 2, 95), v('Saco de pão de queijo', '2026-05-10', 4, 34),
  v('Caixa de brigadeiro', '2026-05-18', 3, 14), v('Cesta Festa', '2026-05-25', 1, 145),
  v('Bolo de chocolate', '2026-06-03', 2, 98), v('Saco de pão de queijo', '2026-06-07', 5, 35),
  v('Caixa de brigadeiro', '2026-06-10', 2, 15), v('Brigadeiro avulso', '2026-06-11', 12, 2.5),
  v('Cesta Festa', '2026-06-12', 1, 150),
];

const doc = { version: 1, insumos, receitas, produtos, fornadas, vendas };
mkdirSync('samples', { recursive: true });
writeFileSync('samples/exemplo-confeitaria.yaml', toYaml(doc));
console.log(`Wrote samples/exemplo-confeitaria.yaml — ${insumos.length} insumos, ${receitas.length} receitas, ${produtos.length} produtos, ${vendas.length} vendas, ${fornadas.length} fornadas.`);
