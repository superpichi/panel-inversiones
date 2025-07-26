import React, { useState, useMemo, useEffect } from 'react';
import { BarChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { PlusCircle, Briefcase, User, TrendingUp, BookOpen, Percent, CheckCircle, XCircle, LogOut, Loader2 } from 'lucide-react';

// --- PASO 1: CONFIGURACIÓN DE FIREBASE ---
import { initializeApp } from "firebase/app";
import { 
    getAuth, 
    onAuthStateChanged, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut 
} from "firebase/auth";
import { 
    getFirestore, 
    collection, 
    addDoc, 
    query, 
    onSnapshot,
    doc,
    getDoc,
    setDoc
} from "firebase/firestore";

// --- CÓDIGO SEGURO: LEE LAS LLAVES DESDE VARIABLES DE ENTORNO ---
// Ya no se escriben las llaves directamente en el código.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY,
  authDomain: import.meta.env.VITE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_APP_ID
};

// Inicializa Firebase y sus servicios
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- DATOS SEMI-ESTÁTICOS (PUEDEN MOVERSE A FIREBASE EN EL FUTURO) ---
const exchangeRates = { 'USD_ARS': 1050.50 };
const currentPrices = {
    'AAPL': { price: 195, currency: 'USD' }, 'MELI': { price: 1450, currency: 'ARS' }, 'FCI-TECH': { price: 12, currency: 'ARS' },
    'ROFEX20': { price: 52000, currency: 'ARS' }, 'GOOGL': { price: 135, currency: 'USD' }, 'BMA': { price: 850, currency: 'ARS' },
    'FCI-AGRO': { price: 25, currency: 'ARS' }, 'USD': { price: 1, currency: 'USD' }, 'ARS': { price: 1, currency: 'ARS' },
};
const benchmarksData = {
    'S&P 500': [ { month: 'Ene', value: 100 }, { month: 'Feb', value: 102 }, { month: 'Mar', value: 105 }, { month: 'Abr', value: 103 }, { month: 'May', value: 108 }, { month: 'Jun', value: 112 }, ],
    'Merval': [ { month: 'Ene', value: 100 }, { month: 'Feb', value: 98 }, { month: 'Mar', value: 101 }, { month: 'Abr', value: 105 }, { month: 'May', value: 104 }, { month: 'Jun', value: 109 }, ],
};


// --- HOOK PERSONALIZADO PARA MANEJAR LAS OPERACIONES CON FIRESTORE ---
const useOperations = (userId, profileId) => {
    const [operations, setOperations] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!userId || !profileId) {
            setOperations([]);
            setLoading(false);
            return;
        };

        // La ruta a tu colección de operaciones. Es única para cada usuario y perfil.
        const operationsPath = `users/${userId}/profiles/${profileId}/operations`;
        const q = query(collection(db, operationsPath));
        
        // onSnapshot escucha cambios en tiempo real en la base de datos.
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const ops = [];
            querySnapshot.forEach((doc) => {
                ops.push({ id: doc.id, ...doc.data() });
            });
            setOperations(ops);
            setLoading(false);
        }, (error) => {
            console.error("Error al obtener operaciones: ", error);
            setLoading(false);
        });

        // Se desuscribe del listener cuando el componente se desmonta para evitar fugas de memoria.
        return () => unsubscribe();
    }, [userId, profileId]);

    const addOperation = async (operationData) => {
        if (!userId || !profileId) return;
        const operationsPath = `users/${userId}/profiles/${profileId}/operations`;
        try {
            await addDoc(collection(db, operationsPath), operationData);
        } catch (error) {
            console.error("Error al agregar operación: ", error);
        }
    };

    return { operations, addOperation, loading };
};


// --- LÓGICA DE CÁLCULO (SIN CAMBIOS) ---
const usePortfolioCalculations = (operations, currentPrices, exchangeRates) => {
    return useMemo(() => {
        if (!operations) return { portfolio: [], totals: {}, allocation: [], realizedGains: {}, baseCurrency: 'ARS' };
        const baseCurrency = 'ARS';
        const usdToArsRate = exchangeRates.USD_ARS;
        const getRate = (currency) => currency === 'USD' ? usdToArsRate : 1;
        const holdings = {};
        let winningTrades = 0;
        let losingTrades = 0;
        const sortedOps = [...operations].sort((a, b) => new Date(a.date) - new Date(b.date));
        sortedOps.forEach(op => {
            if (!holdings[op.ticker]) {
                holdings[op.ticker] = { quantity: 0, totalCostInBase: 0 };
            }
            const opRate = getRate(op.currency);
            const feeInBase = (op.fee || 0) * opRate;
            if (op.type === 'Compra') {
                const costInBase = op.quantity * op.price * opRate + feeInBase;
                holdings[op.ticker].quantity += op.quantity;
                holdings[op.ticker].totalCostInBase += costInBase;
            } else {
                if (holdings[op.ticker].quantity > 0) {
                    const avgCostPerUnit = holdings[op.ticker].totalCostInBase / holdings[op.ticker].quantity;
                    const costOfSoldUnits = op.quantity * avgCostPerUnit;
                    const proceedsInBase = op.quantity * op.price * opRate - feeInBase;
                    const profit = proceedsInBase - costOfSoldUnits;
                    if (profit > 0) winningTrades++; else losingTrades++;
                    holdings[op.ticker].quantity -= op.quantity;
                    holdings[op.ticker].totalCostInBase -= costOfSoldUnits;
                }
            }
        });
        const totalClosedTrades = winningTrades + losingTrades;
        const winRatio = totalClosedTrades > 0 ? (winningTrades / totalClosedTrades) * 100 : 0;
        const realizedGains = { winningTrades, losingTrades, totalClosedTrades, winRatio };
        const portfolio = {};
        operations.forEach(op => {
            if (!portfolio[op.ticker]) {
                portfolio[op.ticker] = { ticker: op.ticker, assetType: op.assetType, quantity: 0, totalCostInBase: 0, totalBuyQuantity: 0 };
            }
            const opRate = getRate(op.currency);
            const feeInBase = (op.fee || 0) * opRate;
            if (op.type === 'Compra') {
                portfolio[op.ticker].quantity += op.quantity;
                portfolio[op.ticker].totalCostInBase += (op.quantity * op.price * opRate) + feeInBase;
                portfolio[op.ticker].totalBuyQuantity += op.quantity;
            } else {
                portfolio[op.ticker].quantity -= op.quantity;
            }
        });
        const consolidatedPortfolio = Object.values(portfolio).filter(asset => asset.quantity > 0.0001).map(asset => {
            const currentPriceInfo = currentPrices[asset.ticker] || { price: 0, currency: 'ARS' };
            const avgCostInBase = asset.totalBuyQuantity > 0 ? asset.totalCostInBase / asset.totalBuyQuantity : 0;
            const marketValueInBase = asset.quantity * currentPriceInfo.price * getRate(currentPriceInfo.currency);
            const costBasisInBase = asset.quantity * avgCostInBase;
            const gainLossInBase = marketValueInBase - costBasisInBase;
            const gainLossPercent = costBasisInBase > 0 ? (gainLossInBase / costBasisInBase) * 100 : 0;
            return { ...asset, avgCostInBase, currentPrice: currentPriceInfo.price, currentPriceCurrency: currentPriceInfo.currency, marketValueInBase, gainLossInBase, gainLossPercent };
        });
        const totals = {
            totalInvested: consolidatedPortfolio.reduce((sum, asset) => sum + (asset.quantity * asset.avgCostInBase), 0),
            totalMarketValue: consolidatedPortfolio.reduce((sum, asset) => sum + asset.marketValueInBase, 0),
        };
        totals.totalGainLoss = totals.totalMarketValue - totals.totalInvested;
        totals.totalGainLossPercent = totals.totalInvested > 0 ? (totals.totalGainLoss / totals.totalInvested) * 100 : 0;
        const allocation = Object.values(consolidatedPortfolio.reduce((acc, asset) => {
            const type = asset.assetType;
            if (!acc[type]) acc[type] = { name: type, value: 0 };
            acc[type].value += asset.marketValueInBase;
            return acc;
        }, {}));
        return { portfolio: consolidatedPortfolio, totals, allocation, realizedGains, baseCurrency };
    }, [operations, currentPrices, exchangeRates]);
};

// --- COMPONENTES DE UI (SIN CAMBIOS GRANDES, ADAPTADOS PARA RECIBIR PROPS) ---
const Card = ({ children, className = '' }) => (<div className={`bg-white dark:bg-gray-800 shadow-lg rounded-xl p-6 transition-all duration-300 ${className}`}>{children}</div>);
const ProfileSwitcher = ({ activeProfile, setActiveProfile }) => (
    <div className="flex items-center bg-gray-200 dark:bg-gray-700 rounded-full p-1">
        <button onClick={() => setActiveProfile('personal')} className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-colors duration-300 ${activeProfile === 'personal' ? 'bg-blue-500 text-white' : 'text-gray-600 dark:text-gray-300'}`}><User size={16} /> Personal</button>
        <button onClick={() => setActiveProfile('empresa')} className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-colors duration-300 ${activeProfile === 'empresa' ? 'bg-green-500 text-white' : 'text-gray-600 dark:text-gray-300'}`}><Briefcase size={16} /> Empresa</button>
    </div>
);
const AddOperationForm = ({ onAddOperation }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [formData, setFormData] = useState({ broker: 'Broker A', date: new Date().toISOString().split('T')[0], type: 'Compra', assetType: 'Acción', ticker: '', quantity: '', price: '', currency: 'USD', fee: '' });
    const handleChange = (e) => { const { name, value } = e.target; setFormData(prev => ({ ...prev, [name]: value })); };
    const handleSubmit = (e) => {
        e.preventDefault();
        if (!formData.ticker || !formData.quantity || !formData.price) { alert("Por favor, complete los campos obligatorios."); return; }
        const { id, ...operationData } = { ...formData, quantity: parseFloat(formData.quantity), price: parseFloat(formData.price), fee: parseFloat(formData.fee || 0) };
        onAddOperation(operationData);
        setIsOpen(false);
        setFormData({ broker: 'Broker A', date: new Date().toISOString().split('T')[0], type: 'Compra', assetType: 'Acción', ticker: '', quantity: '', price: '', currency: 'USD', fee: '' });
    };
    return (
        <div>
            <button onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 transition-colors duration-300"><PlusCircle size={20} /> Agregar Operación</button>
            {isOpen && (<div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50"><Card className="w-full max-w-lg"><h3 className="text-xl font-bold mb-4 text-gray-800 dark:text-white">Nueva Operación</h3><form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">{Object.entries(formData).map(([key, value]) => (<div key={key}><label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1 capitalize">{key === 'fee' ? 'Costo Operación' : key.replace(/([A-Z])/g, ' $1')}</label>{key === 'type' || key === 'assetType' || key === 'broker' || key === 'currency' ? (<select name={key} value={value} onChange={handleChange} className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-200">{key === 'type' && <><option>Compra</option><option>Venta</option></>}{key === 'assetType' && <><option>Acción</option><option>CEDEAR</option><option>Futuro</option><option>FCI</option><option>Dólares</option><option>Pesos</option></>}{key === 'broker' && <><option>Broker A</option><option>Broker B</option><option>Broker C</option></>}{key === 'currency' && <><option>USD</option><option>ARS</option></>}</select>) : (<input type={key === 'date' ? 'date' : (key === 'quantity' || key === 'price' || key === 'fee' ? 'number' : 'text')} name={key} value={value} onChange={handleChange} placeholder={key.charAt(0).toUpperCase() + key.slice(1)} className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-200" required={key !== 'fee'} step="0.01" />)}</div>))}{<div className="md:col-span-2 flex justify-end gap-3 mt-4"><button type="button" onClick={() => setIsOpen(false)} className="px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500">Cancelar</button><button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Guardar</button></div>}</form></Card></div>)}
        </div>
    );
};
const Dashboard = ({ totals, allocation, portfolioPerformance, realizedGains, baseCurrency }) => { /* ...código sin cambios... */ return ( <div className="grid grid-cols-1 lg:grid-cols-3 gap-6"> <Card className="lg:col-span-3"> <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-4">Resumen General de Cartera</h2> <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center"> <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-lg"><h3 className="text-sm text-gray-500 dark:text-gray-400">Valor de Mercado ({baseCurrency})</h3><p className="text-2xl font-bold text-green-500">${totals.totalMarketValue?.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></div> <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-lg"><h3 className="text-sm text-gray-500 dark:text-gray-400">G/P No Realizada ({baseCurrency})</h3><p className={`text-2xl font-bold ${totals.totalGainLoss >= 0 ? 'text-green-500' : 'text-red-500'}`}>${totals.totalGainLoss?.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></div> <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-lg"><h3 className="text-sm text-gray-500 dark:text-gray-400">Total Invertido ({baseCurrency})</h3><p className="text-2xl font-bold text-blue-500">${totals.totalInvested?.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></div> <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-lg"><h3 className="text-sm text-gray-500 dark:text-gray-400">Rentabilidad Actual</h3><p className={`text-2xl font-bold ${totals.totalGainLossPercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>{totals.totalGainLossPercent?.toFixed(2)}%</p></div> </div> </Card> <Card className="lg:col-span-3"> <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-4">Análisis de Trades Cerrados</h2> <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center"> <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center flex-col"><CheckCircle className="text-green-500 mb-2" size={32}/><h3 className="text-sm text-gray-500 dark:text-gray-400">Operaciones Ganadoras</h3><p className="text-2xl font-bold text-green-500">{realizedGains.winningTrades}</p></div> <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center flex-col"><XCircle className="text-red-500 mb-2" size={32}/><h3 className="text-sm text-gray-500 dark:text-gray-400">Operaciones Perdedoras</h3><p className="text-2xl font-bold text-red-500">{realizedGains.losingTrades}</p></div> <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center flex-col"><Percent className="text-blue-500 mb-2" size={32}/><h3 className="text-sm text-gray-500 dark:text-gray-400">Ratio de Efectividad</h3><p className="text-2xl font-bold text-blue-500">{realizedGains.winRatio.toFixed(2)}%</p></div> </div> </Card> <Card className="lg:col-span-2"><h2 className="text-xl font-bold text-gray-800 dark:text-white mb-4">Rendimiento vs Benchmarks</h2><ResponsiveContainer width="100%" height={300}><LineChart data={portfolioPerformance}><CartesianGrid strokeDasharray="3 3" stroke="rgba(128, 128, 128, 0.2)" /><XAxis dataKey="month" stroke="rgb(156 163 175)"/><YAxis stroke="rgb(156 163 175)"/><Tooltip contentStyle={{ backgroundColor: 'rgba(31, 41, 55, 0.8)', borderColor: 'rgba(128, 128, 128, 0.5)', color: '#fff' }}/><Legend /><Line type="monotone" dataKey="portfolio" name="Mi Cartera" stroke="#8884d8" strokeWidth={2} /><Line type="monotone" dataKey="sp500" name="S&P 500" stroke="#82ca9d" strokeDasharray="5 5" /><Line type="monotone" dataKey="merval" name="Merval" stroke="#ffc658" strokeDasharray="5 5" /></LineChart></ResponsiveContainer></Card> <Card><h2 className="text-xl font-bold text-gray-800 dark:text-white mb-4">Distribución de Activos</h2><ResponsiveContainer width="100%" height={300}><PieChart><Pie data={allocation} cx="50%" cy="50%" labelLine={false} outerRadius={80} fill="#8884d8" dataKey="value" nameKey="name" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>{allocation.map((entry, index) => (<Cell key={`cell-${index}`} fill={['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#AF19FF', '#FF4560'][index % 6]} />))}</Pie><Tooltip formatter={(value) => `$${value.toLocaleString('es-AR')}`} /><Legend /></PieChart></ResponsiveContainer></Card> </div> ); };
const PortfolioView = ({ portfolio, baseCurrency }) => { /* ...código sin cambios... */ return ( <Card> <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-4">Cartera Detallada</h2> <div className="overflow-x-auto"> <table className="w-full text-left text-sm text-gray-500 dark:text-gray-400"> <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-700 dark:text-gray-400"><tr><th scope="col" className="px-6 py-3">Ticker</th><th scope="col" className="px-6 py-3">Tipo</th><th scope="col" className="px-6 py-3 text-right">Cantidad</th><th scope="col" className="px-6 py-3 text-right">Costo Prom. ({baseCurrency})</th><th scope="col" className="px-6 py-3 text-right">Precio Actual</th><th scope="col" className="px-6 py-3 text-right">Valor Mercado ({baseCurrency})</th><th scope="col" className="px-6 py-3 text-right">G/P ({baseCurrency})</th><th scope="col" className="px-6 py-3 text-right">G/P (%)</th></tr></thead> <tbody> {portfolio.map(asset => ( <tr key={asset.ticker} className="bg-white border-b dark:bg-gray-800 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600"> <th scope="row" className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap dark:text-white">{asset.ticker}</th> <td className="px-6 py-4">{asset.assetType}</td> <td className="px-6 py-4 text-right">{asset.quantity.toLocaleString('es-AR', { maximumFractionDigits: 2 })}</td> <td className="px-6 py-4 text-right">${(asset.avgCostInBase / (asset.totalCostInBase / asset.totalBuyQuantity > 0 ? 1 : 0) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td> <td className="px-6 py-4 text-right">${asset.currentPrice.toLocaleString('es-AR', { minimumFractionDigits: 2 })} {asset.currentPriceCurrency}</td> <td className="px-6 py-4 text-right font-semibold">${asset.marketValueInBase.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td> <td className={`px-6 py-4 text-right font-semibold ${asset.gainLossInBase >= 0 ? 'text-green-500' : 'text-red-500'}`}>${asset.gainLossInBase.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td> <td className={`px-6 py-4 text-right font-semibold ${asset.gainLossPercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>{asset.gainLossPercent.toFixed(2)}%</td> </tr> ))} </tbody> </table> </div> </Card> ); };
const OperationsView = ({ operations }) => { /* ...código sin cambios... */ return ( <Card> <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-4">Historial de Operaciones</h2> <div className="overflow-x-auto"> <table className="w-full text-left text-sm text-gray-500 dark:text-gray-400"> <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-700 dark:text-gray-400"><tr><th scope="col" className="px-6 py-3">Fecha</th><th scope="col" className="px-6 py-3">Broker</th><th scope="col" className="px-6 py-3">Tipo</th><th scope="col" className="px-6 py-3">Activo</th><th scope="col" className="px-6 py-3 text-right">Cantidad</th><th scope="col" className="px-6 py-3 text-right">Precio</th><th scope="col" className="px-6 py-3 text-right">Costo Op.</th><th scope="col" className="px-6 py-3 text-right">Total</th></tr></thead> <tbody> {[...operations].sort((a, b) => new Date(b.date) - new Date(a.date)).map(op => ( <tr key={op.id} className="bg-white border-b dark:bg-gray-800 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600"> <td className="px-6 py-4">{new Date(op.date).toLocaleDateString('es-AR')}</td><td className="px-6 py-4">{op.broker}</td><td className={`px-6 py-4 font-semibold ${op.type === 'Compra' ? 'text-green-500' : 'text-red-500'}`}>{op.type}</td><td className="px-6 py-4 font-medium text-gray-900 dark:text-white">{op.ticker}</td><td className="px-6 py-4 text-right">{op.quantity.toLocaleString('es-AR')}</td><td className="px-6 py-4 text-right">${op.price.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td><td className="px-6 py-4 text-right">${(op.fee || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td><td className="px-6 py-4 text-right">${(op.quantity * op.price).toLocaleString('es-AR', { minimumFractionDigits: 2 })} {op.currency}</td> </tr> ))} </tbody> </table> </div> </Card> ); };

// --- COMPONENTE DE LOGIN ---
const LoginScreen = ({ setErrorMessage }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isSigningUp, setIsSigningUp] = useState(false);

    const handleAuthAction = async (e) => {
        e.preventDefault();
        setErrorMessage('');
        try {
            if (isSigningUp) {
                await createUserWithEmailAndPassword(auth, email, password);
            } else {
                await signInWithEmailAndPassword(auth, email, password);
            }
        } catch (error) {
            console.error("Error de autenticación:", error.message);
            setErrorMessage(error.message);
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
            <Card className="w-full max-w-sm">
                <div className="flex flex-col items-center mb-6">
                    <div className="bg-gradient-to-r from-blue-500 to-indigo-600 p-3 rounded-full mb-4">
                        <TrendingUp size={32} className="text-white"/>
                    </div>
                    <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Panel de Inversiones</h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">{isSigningUp ? 'Crea una cuenta para empezar' : 'Inicia sesión para continuar'}</p>
                </div>
                <form onSubmit={handleAuthAction} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-600 dark:text-gray-300">Email</label>
                        <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1 w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-700" required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-600 dark:text-gray-300">Contraseña</label>
                        <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1 w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-700" required />
                    </div>
                    <button type="submit" className="w-full py-2 px-4 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 transition-colors duration-300">
                        {isSigningUp ? 'Registrarse' : 'Iniciar Sesión'}
                    </button>
                </form>
                <div className="mt-4 text-center">
                    <button onClick={() => setIsSigningUp(!isSigningUp)} className="text-sm text-indigo-500 hover:underline">
                        {isSigningUp ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate'}
                    </button>
                </div>
            </Card>
        </div>
    );
};


// --- COMPONENTE PRINCIPAL DE LA APP ---
const AppContent = ({ user }) => {
    const [activeProfile, setActiveProfile] = useState('personal');
    const [activeView, setActiveView] = useState('dashboard');
    
    // Usamos nuestro hook personalizado para obtener las operaciones del usuario logueado y el perfil activo.
    const { operations, addOperation, loading: operationsLoading } = useOperations(user.uid, activeProfile);

    const { portfolio, totals, allocation, realizedGains, baseCurrency } = usePortfolioCalculations(operations, currentPrices, exchangeRates);
    
    const portfolioPerformance = useMemo(() => {
        return benchmarksData['S&P 500'].map((point, index) => ({
            month: point.month, portfolio: 100 + (totals.totalGainLossPercent || 0) * (index + 1) / 6,
            sp500: benchmarksData['S&P 500'][index].value, merval: benchmarksData['Merval'][index].value,
        }));
    }, [totals.totalGainLossPercent]);

    const handleSignOut = () => {
        signOut(auth).catch(error => console.error("Error al cerrar sesión:", error));
    };

    const NavButton = ({ view, label, icon: Icon }) => (<button onClick={() => setActiveView(view)} className={`flex items-center gap-3 px-4 py-2 rounded-lg font-semibold transition-colors duration-200 ${activeView === view ? 'bg-blue-100 dark:bg-gray-700 text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}><Icon size={20} /><span>{label}</span></button>);

    const renderView = () => {
        if (operationsLoading) {
            return <div className="flex justify-center items-center h-64"><Loader2 className="animate-spin text-indigo-500" size={48} /></div>;
        }
        switch (activeView) {
            case 'portfolio': return <PortfolioView portfolio={portfolio} baseCurrency={baseCurrency} />;
            case 'operations': return <OperationsView operations={operations} />;
            case 'dashboard': default: return <Dashboard totals={totals} allocation={allocation} portfolioPerformance={portfolioPerformance} realizedGains={realizedGains} baseCurrency={baseCurrency}/>;
        }
    };

    return (
        <div className="bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 min-h-screen font-sans">
            <div className="flex">
                <aside className="w-64 bg-white dark:bg-gray-800 p-6 flex-col hidden md:flex shadow-lg justify-between">
                    <div>
                        <div className="flex items-center gap-3 mb-10"><div className="bg-gradient-to-r from-blue-500 to-indigo-600 p-2 rounded-lg"><TrendingUp size={24} className="text-white"/></div><h1 className="text-2xl font-bold">Inversiones</h1></div>
                        <nav className="flex flex-col gap-4"><NavButton view="dashboard" label="Dashboard" icon={BarChart} /><NavButton view="portfolio" label="Cartera" icon={Briefcase} /><NavButton view="operations" label="Operaciones" icon={BookOpen} /></nav>
                    </div>
                    <div className="border-t dark:border-gray-700 pt-4">
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate" title={user.email}>{user.email}</p>
                        <button onClick={handleSignOut} className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2 bg-red-500 text-white font-semibold rounded-lg shadow-md hover:bg-red-600 transition-colors duration-300"><LogOut size={16} />Cerrar Sesión</button>
                    </div>
                </aside>
                <main className="flex-1 p-4 md:p-8">
                    <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                           <ProfileSwitcher activeProfile={activeProfile} setActiveProfile={setActiveProfile} />
                           <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-3 py-1 rounded-full">T/C (USD/ARS): ${exchangeRates.USD_ARS.toFixed(2)}</div>
                        </div>
                        <AddOperationForm onAddOperation={addOperation} />
                    </header>
                    {renderView()}
                </main>
            </div>
        </div>
    );
}

export default function App() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState('');

    useEffect(() => {
        // Este listener de Firebase se ejecuta cuando el usuario inicia/cierra sesión.
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            setLoading(false);
        });
        return () => unsubscribe(); // Limpieza al desmontar
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
                <Loader2 className="animate-spin text-indigo-500" size={64} />
            </div>
        );
    }

    if (errorMessage) {
        // Muestra un mensaje de error si falla el login/signup
        setTimeout(() => setErrorMessage(''), 5000); // Limpia el error después de 5 segundos
    }

    return user ? <AppContent user={user} /> : (
        <>
            <LoginScreen setErrorMessage={setErrorMessage} />
            {errorMessage && (
                <div className="fixed bottom-5 right-5 bg-red-500 text-white py-2 px-4 rounded-lg shadow-lg">
                    {errorMessage}
                </div>
            )}
        </>
    );
}
