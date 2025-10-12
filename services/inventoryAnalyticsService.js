import Inventory from '../models/Inventory.js';
import Product from '../models/Product.js';
import InventoryHistory from '../models/InventoryHistory.js';
import Order from '../models/Order.js';
import Category from '../models/Category.js';
import { StatusCodes } from 'http-status-codes';
import { ApiError } from '../utils/ApiError.js';
import * as XLSX from 'xlsx';

class InventoryAnalyticsService {
  async getAnalytics(dateRange) {
    try {
      const { start, end } = dateRange;

      // Get current inventory data
      const inventory = await Inventory.find().populate('product', 'name price category');
  const totalValue = inventory.reduce((sum, item) => {
        const price = item.product?.price || 0;
        return sum + (item.quantity * price);
      }, 0);

  // Get historical data for comparison
  const DAY_MS = 1000 * 60 * 60 * 24;
  const startMs = start instanceof Date ? start.getTime() : Date.now() - 30 * DAY_MS;
  const endMs = end instanceof Date ? end.getTime() : Date.now();
  const diffDays = Math.max(1, Math.ceil((endMs - startMs) / DAY_MS));
  const previousStart = new Date(startMs);
  previousStart.setDate(previousStart.getDate() - diffDays);
      
      const previousInventory = await this.getHistoricalInventoryValue(previousStart, start);
      const valueChange = previousInventory > 0 ? ((totalValue - previousInventory) / previousInventory) * 100 : 0;

      // Get value history for the period
      const valueHistory = await this.getValueHistory(start, end);

      // Calculate turnover metrics
      const turnoverMetrics = await this.calculateTurnoverMetrics(start, end);


      // Robust totals and unique counts
      const totalItems = inventory.reduce((sum, item) => {
        const qty = Number(item.quantity);
        return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0);
      }, 0);

      // Estimate reserved units from open orders (pending -> shipped)
      const openOrders = await Order.find({
        status: { $in: ['pending', 'processing', 'shipped'] }
      }).select('items');
      const reservedUnits = openOrders.reduce((sum, o) => sum + (o.items?.reduce((s, it) => s + (Number(it.quantity) || 0), 0) || 0), 0);
      const availableUnits = Math.max(0, totalItems - reservedUnits);

  const uniqueProducts = (() => {
        const ids = new Set();
        for (const item of inventory) {
          const pid = item.product?._id?.toString?.() || (typeof item.product === 'string' ? item.product : null);
          if (pid) ids.add(pid);
        }
        return ids.size;
      })();

  const variantsInStockCount = inventory.reduce((sum, item) => sum + ((Number(item.quantity) || 0) > 0 ? 1 : 0), 0);

      // Status breakdown and variant count (useful for UI)
      const statusCounts = inventory.reduce((acc, item) => {
        const st = item.status || 'in_stock';
        acc[st] = (acc[st] || 0) + 1;
        return acc;
      }, {});

      return {
        totalValue,
        valueChange,
  totalItems,
  reservedUnits,
  availableUnits,
        uniqueProducts,
  variantCount: inventory.length,
  variantsInStockCount,
        inStockCount: statusCounts['in_stock'] || 0,
        lowStockCount: statusCounts['low_stock'] || 0,
        outOfStockCount: statusCounts['out_of_stock'] || 0,
        turnoverRate: turnoverMetrics.averageTurnover,
        avgDaysInStock: turnoverMetrics.averageDaysInStock,
        valueHistory
      };
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error calculating analytics');
    }
  }

  async getStockMovements(dateRange) {
    try {
      const { start, end } = dateRange;

      // Validate/normalize dates to avoid invalid query ranges
  const startDate = start instanceof Date && !isNaN(start.getTime()) ? start : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endDate = end instanceof Date && !isNaN(end.getTime()) ? end : new Date();

      const movements = await InventoryHistory.find({
        timestamp: { $gte: startDate, $lte: endDate }
      })
        .populate('product', 'name')
        .populate('user', 'name')
        .sort({ timestamp: -1 })
        .lean();

      // Safely map movements even if related docs are missing
      return movements.map(movement => {
        const ts = movement.timestamp || movement.createdAt || new Date();
        const productId = movement.product?._id?.toString() || (typeof movement.product === 'string' ? movement.product : null);
        const userId = movement.user?._id?.toString() || (typeof movement.user === 'string' ? movement.user : null);

        return {
          date: new Date(ts).toISOString(),
          product: {
            _id: productId,
            name: movement.product?.name || 'Unknown Product'
          },
          type: movement.type,
          quantity: movement.quantity ?? 0,
          reason: movement.reason || 'N/A',
          location: 'Main Warehouse', // Default for now
          user: {
            _id: userId,
            name: movement.user?.name || 'System'
          }
        };
      });
    } catch (error) {
      // Preserve internal error detail in logs while returning safe message
      console.error('getStockMovements failed:', error);
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error fetching stock movements');
    }
  }

  async getTurnoverAnalysis(dateRange) {
    try {
      const { start, end } = dateRange;
      const DAY_MS = 1000 * 60 * 60 * 24;
      const startMs = start instanceof Date ? start.getTime() : Date.now() - 30 * DAY_MS;
      const endMs = end instanceof Date ? end.getTime() : Date.now();
      const daysInPeriod = Math.max(1, Math.ceil((endMs - startMs) / DAY_MS));
      
      // Get inventory items with product details
      const inventory = await Inventory.find()
        .populate('product', 'name category price');

      // Get order data for turnover calculation
      const orders = await Order.find({
        createdAt: { $gte: new Date(startMs), $lte: new Date(endMs) },
        status: { $in: ['delivered', 'completed'] }
      });

      const turnoverData = [];

      for (const item of inventory) {
        if (!item.product) continue;

        // Calculate sold quantity from orders
        const soldQuantity = orders.reduce((sum, order) => {
          const orderItem = order.items.find(oi => oi.product.toString() === item.product._id.toString());
          return sum + (orderItem ? orderItem.quantity : 0);
        }, 0);

        // Calculate metrics
        const currentStock = item.quantity;
        const averageStock = currentStock; // Simplified for now
        const turnoverRate = averageStock > 0 ? soldQuantity / averageStock : 0;
        const daysInStock = turnoverRate > 0 ? daysInPeriod / turnoverRate : daysInPeriod;

        // Determine status
        let status = 'healthy';
        if (turnoverRate === 0 && daysInStock > 90) {
          status = 'dead_stock';
        } else if (turnoverRate < 0.5) {
          status = 'slow_moving';
        } else if (turnoverRate > 3) {
          status = 'fast_moving';
        }

        turnoverData.push({
          product: {
            _id: item.product._id,
            name: item.product.name,
            category: item.product.category || 'Uncategorized'
          },
          currentStock,
          averageStock,
          soldQuantity,
          turnoverRate,
          daysInStock: Math.round(daysInStock),
          reorderPoint: Math.max(5, Math.round(soldQuantity * 0.3)), // 30% of sold quantity
          status
        });
      }

      return turnoverData;
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error calculating turnover analysis');
    }
  }

  async getCategoryBreakdown(dateRange) {
    try {
      // Get all categories
      const categories = await Category.find();
      const categoryMap = new Map(categories.map(cat => [cat._id.toString(), cat.name]));

      // Get inventory grouped by category
      const inventory = await Inventory.find()
        .populate('product', 'name category price');

      const categoryData = new Map();

      for (const item of inventory) {
        if (!item.product) continue;

        const categoryId = item.product.category?.toString() || 'uncategorized';
        const categoryName = categoryMap.get(categoryId) || 'Uncategorized';
        const itemValue = item.quantity * (item.product.price || 0);

        if (!categoryData.has(categoryName)) {
          categoryData.set(categoryName, {
            category: categoryName,
            totalValue: 0,
            totalItems: 0,
            products: []
          });
        }

        const data = categoryData.get(categoryName);
        data.totalValue += itemValue;
        data.totalItems += item.quantity;
        data.products.push(item);
      }

      const totalValue = Array.from(categoryData.values()).reduce((sum, cat) => sum + cat.totalValue, 0);

      return Array.from(categoryData.values()).map(data => ({
        category: data.category,
        totalValue: data.totalValue,
        totalItems: data.totalItems,
        percentageOfTotal: totalValue > 0 ? (data.totalValue / totalValue) * 100 : 0,
        turnoverRate: this.calculateCategoryTurnover(data.products), // Simplified
        profitMargin: 25 // Placeholder - would need cost data
      }));
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error calculating category breakdown');
    }
  }

  async getLocationAnalysis(dateRange) {
    try {
      const inventory = await Inventory.find()
        .populate('product', 'name price');

      const locationData = new Map();

      for (const item of inventory) {
        if (!item.product) continue;

        const location = item.location || 'Main Warehouse';
        const itemValue = item.quantity * (item.product.price || 0);

        if (!locationData.has(location)) {
          locationData.set(location, {
            location,
            totalValue: 0,
            totalItems: 0,
            products: [],
            alertCount: 0
          });
        }

        const data = locationData.get(location);
        data.totalValue += itemValue;
        data.totalItems += item.quantity;
        data.products.push(item);

        // Count alerts (low stock, out of stock)
        if (item.status === 'low_stock' || item.status === 'out_of_stock') {
          data.alertCount++;
        }
      }

      return Array.from(locationData.values()).map(data => ({
        location: data.location,
        totalValue: data.totalValue,
        totalItems: data.totalItems,
        utilizationRate: Math.min(100, (data.products.length / 100) * 100), // Simplified
        averageTurnover: this.calculateLocationTurnover(data.products), // Simplified
        alertCount: data.alertCount
      }));
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error calculating location analysis');
    }
  }

  async getAlerts() {
    try {
      const inventory = await Inventory.find()
        .populate('product', 'name');

      const alerts = {
        lowStock: [],
        outOfStock: [],
        deadStock: [],
        overstock: []
      };

      for (const item of inventory) {
        if (!item.product) continue;

        // Low stock alerts
        if (item.status === 'low_stock') {
          alerts.lowStock.push({
            product: item.product.name,
            currentStock: item.quantity,
            threshold: item.lowStockThreshold,
            location: item.location || 'Main Warehouse'
          });
        }

        // Out of stock alerts
        if (item.status === 'out_of_stock') {
          alerts.outOfStock.push({
            product: item.product.name,
            location: item.location || 'Main Warehouse',
            lastSold: new Date().toISOString() // Placeholder
          });
        }

        // Dead stock (no movement for 90+ days) - simplified
        if (item.quantity > 0 && this.getDaysSinceLastUpdate(item.lastUpdated) > 90) {
          alerts.deadStock.push({
            product: item.product.name,
            daysInStock: this.getDaysSinceLastUpdate(item.lastUpdated),
            currentStock: item.quantity,
            location: item.location || 'Main Warehouse'
          });
        }

        // Overstock (quantity > 3x average demand) - simplified
        if (item.quantity > 50) { // Simplified threshold
          alerts.overstock.push({
            product: item.product.name,
            currentStock: item.quantity,
            averageDemand: 15, // Placeholder
            location: item.location || 'Main Warehouse'
          });
        }
      }

      return alerts;
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error fetching alerts');
    }
  }

  async exportAnalytics(options) {
    try {
      const { start, end, format } = options;
      
      const analytics = await this.getAnalytics({ start, end });
      const movements = await this.getStockMovements({ start, end });
      const turnover = await this.getTurnoverAnalysis({ start, end });
      const categories = await this.getCategoryBreakdown({ start, end });
      const locations = await this.getLocationAnalysis({ start, end });

      if (format === 'excel') {
        const workbook = XLSX.utils.book_new();

        // Analytics summary sheet
        const summaryData = [
          ['Metric', 'Value'],
          ['Total Inventory Value', analytics.totalValue],
          ['Total Items', analytics.totalItems],
          ['Unique Products', analytics.uniqueProducts],
          ['Average Turnover Rate', analytics.turnoverRate],
          ['Average Days in Stock', analytics.avgDaysInStock]
        ];
        const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

        // Turnover analysis sheet
        if (turnover.length > 0) {
          const turnoverSheet = XLSX.utils.json_to_sheet(turnover.map(item => ({
            Product: item.product.name,
            Category: item.product.category,
            'Current Stock': item.currentStock,
            'Turnover Rate': item.turnoverRate,
            'Days in Stock': item.daysInStock,
            Status: item.status
          })));
          XLSX.utils.book_append_sheet(workbook, turnoverSheet, 'Turnover Analysis');
        }

        // Category breakdown sheet
        if (categories.length > 0) {
          const categorySheet = XLSX.utils.json_to_sheet(categories.map(cat => ({
            Category: cat.category,
            'Total Value': cat.totalValue,
            'Total Items': cat.totalItems,
            'Percentage of Total': cat.percentageOfTotal,
            'Turnover Rate': cat.turnoverRate
          })));
          XLSX.utils.book_append_sheet(workbook, categorySheet, 'Categories');
        }

        return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      } else {
        // CSV format - return summary data
        const csvData = [
          ['Metric', 'Value'],
          ['Total Inventory Value', analytics.totalValue],
          ['Total Items', analytics.totalItems],
          ['Unique Products', analytics.uniqueProducts],
          ['Average Turnover Rate', analytics.turnoverRate],
          ['Average Days in Stock', analytics.avgDaysInStock]
        ];
        
        return csvData.map(row => row.join(',')).join('\n');
      }
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error exporting analytics');
    }
  }

  // Helper methods
  async getHistoricalInventoryValue(start, end) {
    // Simplified - in real implementation, would calculate historical values
    return 0;
  }

  async getValueHistory(start, end) {
    // Simplified - generate sample data points
    const DAY_MS = 1000 * 60 * 60 * 24;
    const startMs = start instanceof Date ? start.getTime() : Date.now() - 30 * DAY_MS;
    const endMs = end instanceof Date ? end.getTime() : Date.now();
    const days = Math.max(0, Math.ceil((endMs - startMs) / DAY_MS));
    const history = [];
    
    for (let i = 0; i < Math.min(days, 30); i++) {
      const date = new Date(startMs);
      date.setDate(date.getDate() + i);
      
      history.push({
        date: date.toISOString().split('T')[0],
        value: Math.random() * 100000 + 50000, // Sample data
        change: (Math.random() - 0.5) * 10
      });
    }
    
    return history;
  }

  async calculateTurnoverMetrics(start, end) {
    return {
      averageTurnover: 1.5,
      averageDaysInStock: 45
    };
  }

  calculateCategoryTurnover(products) {
    return Math.random() * 3; // Simplified
  }

  calculateLocationTurnover(products) {
    return Math.random() * 2.5; // Simplified
  }

  getDaysSinceLastUpdate(lastUpdated) {
  const ts = lastUpdated ? new Date(lastUpdated).getTime() : NaN;
  if (!Number.isFinite(ts)) return Number.MAX_SAFE_INTEGER; // treat unknown as very old
  const DAY_MS = 1000 * 60 * 60 * 24;
  return Math.floor((Date.now() - ts) / DAY_MS);
  }

  // NEW ENHANCED ANALYTICS METHODS

  async getPredictiveAnalytics(dateRange) {
    try {
  const { start, end } = dateRange;
  const DAY_MS = 1000 * 60 * 60 * 24;
  const startMs = start instanceof Date ? start.getTime() : Date.now() - 90 * DAY_MS;
  const endMs = end instanceof Date ? end.getTime() : Date.now();
  const daysDiff = Math.max(1, Math.ceil((endMs - startMs) / DAY_MS));
      
      // Get historical order data for forecasting
      const orders = await Order.find({
        createdAt: { $gte: new Date(startMs - daysDiff * DAY_MS), $lte: new Date(endMs) },
        status: { $in: ['delivered', 'completed'] }
      });

  const inventory = await Inventory.find().populate('product', 'name price category');
      
      const predictions = [];

      for (const item of inventory) {
        if (!item.product) continue;

        // Calculate historical demand
        const productOrders = orders.filter(order => 
          order.items.some(orderItem => orderItem.product.toString() === item.product._id.toString())
        );

        const totalSold = productOrders.reduce((sum, order) => {
          const orderItem = order.items.find(oi => oi.product.toString() === item.product._id.toString());
          return sum + (orderItem?.quantity || 0);
        }, 0);

        const avgDailyDemand = totalSold / (daysDiff * 2); // Using historical period
        const demandTrend = this.calculateDemandTrend(productOrders);
        const seasonalFactor = this.calculateSeasonalFactor(new Date());
        
        // Predict stockout date
        const adjustedDemand = avgDailyDemand * (1 + demandTrend) * seasonalFactor;
        const daysUntilStockout = adjustedDemand > 0 ? Math.floor(item.quantity / adjustedDemand) : 999;
        
        // Predict optimal order quantity using Wilson EOQ formula
        const annualDemand = avgDailyDemand * 365;
        const orderCost = 50; // Assumed ordering cost
        const holdingCost = (item.product.price || 0) * 0.2; // 20% of product price
        const eoq = holdingCost > 0 ? Math.sqrt((2 * annualDemand * orderCost) / holdingCost) : item.quantity;

        predictions.push({
          product: {
            _id: item.product._id,
            name: item.product.name,
            category: item.product.category
          },
          currentStock: item.quantity,
          avgDailyDemand: Math.round(avgDailyDemand * 100) / 100,
          demandTrend: Math.round(demandTrend * 100) / 100,
          seasonalFactor: Math.round(seasonalFactor * 100) / 100,
          predictedStockoutDate: daysUntilStockout < 999 ? 
            new Date(Date.now() + daysUntilStockout * 24 * 60 * 60 * 1000) : null,
          daysUntilStockout: daysUntilStockout < 999 ? daysUntilStockout : null,
          recommendedOrderQuantity: Math.ceil(eoq),
          riskLevel: daysUntilStockout <= 7 ? 'high' : daysUntilStockout <= 30 ? 'medium' : 'low',
          forecastAccuracy: Math.max(0.6, Math.random() * 0.4 + 0.6) // Simulated accuracy
        });
      }

      return {
        predictions: predictions.sort((a, b) => (a.daysUntilStockout || 999) - (b.daysUntilStockout || 999)),
        summary: {
          totalProducts: predictions.length,
          highRisk: predictions.filter(p => p.riskLevel === 'high').length,
          mediumRisk: predictions.filter(p => p.riskLevel === 'medium').length,
          lowRisk: predictions.filter(p => p.riskLevel === 'low').length,
          avgAccuracy: predictions.reduce((sum, p) => sum + p.forecastAccuracy, 0) / predictions.length
        }
      };
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error calculating predictive analytics');
    }
  }

  async getSeasonalAnalysis(dateRange) {
    try {
      const { start, end } = dateRange;
      
      // Get 12 months of historical data for seasonal analysis
      const yearStart = new Date(start);
      yearStart.setFullYear(yearStart.getFullYear() - 1);
      
      const orders = await Order.find({
        createdAt: { $gte: yearStart, $lte: end },
        status: { $in: ['delivered', 'completed'] }
      });

      const monthlyData = {};
      
      // Initialize monthly data
      for (let i = 0; i < 12; i++) {
        const month = new Date(yearStart);
        month.setMonth(month.getMonth() + i);
        const monthKey = month.toISOString().substring(0, 7); // YYYY-MM format
        monthlyData[monthKey] = {
          month: monthKey,
          totalSales: 0,
          totalOrders: 0,
          avgOrderValue: 0,
          topCategories: new Map()
        };
      }

      // Aggregate order data by month
      orders.forEach(order => {
        const monthKey = order.createdAt.toISOString().substring(0, 7);
        if (monthlyData[monthKey]) {
          monthlyData[monthKey].totalSales += order.totalAmount;
          monthlyData[monthKey].totalOrders += 1;
          
          // Track category performance
          order.items.forEach(item => {
            const category = item.category || 'Uncategorized';
            const current = monthlyData[monthKey].topCategories.get(category) || 0;
            monthlyData[monthKey].topCategories.set(category, current + item.quantity);
          });
        }
      });

      // Calculate seasonal indices and trends
      const seasonalData = Object.values(monthlyData).map(month => {
        month.avgOrderValue = month.totalOrders > 0 ? month.totalSales / month.totalOrders : 0;
        month.topCategories = Array.from(month.topCategories.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([category, quantity]) => ({ category, quantity }));
        return month;
      });

      const avgMonthlySales = seasonalData.reduce((sum, month) => sum + month.totalSales, 0) / 12;
      
      seasonalData.forEach(month => {
        month.seasonalIndex = avgMonthlySales > 0 ? month.totalSales / avgMonthlySales : 1;
        month.trend = month.seasonalIndex > 1.2 ? 'peak' : month.seasonalIndex < 0.8 ? 'low' : 'normal';
      });

      return {
        monthlyData: seasonalData,
        insights: {
          peakMonths: seasonalData.filter(m => m.trend === 'peak').map(m => m.month),
          lowMonths: seasonalData.filter(m => m.trend === 'low').map(m => m.month),
          avgSeasonalVariation: this.calculateVariation(seasonalData.map(m => m.seasonalIndex)),
          recommendedStockingPeriods: this.getStockingRecommendations(seasonalData)
        }
      };
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error calculating seasonal analysis');
    }
  }

  async getCostAnalysis(dateRange) {
    try {
      const inventory = await Inventory.find().populate('product', 'name price category costPrice');
      
      let totalInventoryValue = 0;
      let totalCostValue = 0;
      let totalPotentialProfit = 0;
      const categoryAnalysis = new Map();
      
      for (const item of inventory) {
        if (!item.product) continue;
        
        const sellingPrice = item.product.price || 0;
        const costPrice = item.product.costPrice || sellingPrice * 0.6; // 60% if not set
        const quantity = item.quantity;
        
        const itemValue = quantity * sellingPrice;
        const itemCost = quantity * costPrice;
        const itemProfit = itemValue - itemCost;
        
        totalInventoryValue += itemValue;
        totalCostValue += itemCost;
        totalPotentialProfit += itemProfit;
        
        const category = item.product.category?.toString() || 'Uncategorized';
        if (!categoryAnalysis.has(category)) {
          categoryAnalysis.set(category, {
            category,
            inventoryValue: 0,
            costValue: 0,
            potentialProfit: 0,
            marginPercentage: 0,
            items: 0
          });
        }
        
        const catData = categoryAnalysis.get(category);
        catData.inventoryValue += itemValue;
        catData.costValue += itemCost;
        catData.potentialProfit += itemProfit;
        catData.items += 1;
      }
      
      // Calculate margins
      const overallMargin = totalInventoryValue > 0 ? 
        ((totalInventoryValue - totalCostValue) / totalInventoryValue) * 100 : 0;
      
      const categories = Array.from(categoryAnalysis.values()).map(cat => ({
        ...cat,
        marginPercentage: cat.inventoryValue > 0 ? 
          ((cat.inventoryValue - cat.costValue) / cat.inventoryValue) * 100 : 0
      }));

      // Calculate carrying costs (20% annually)
      const annualCarryingCost = totalInventoryValue * 0.2;
      const dailyCarryingCost = annualCarryingCost / 365;
      
      return {
        summary: {
          totalInventoryValue,
          totalCostValue,
          totalPotentialProfit,
          overallMarginPercentage: overallMargin,
          annualCarryingCost,
          dailyCarryingCost,
          returnOnInventoryInvestment: totalCostValue > 0 ? (totalPotentialProfit / totalCostValue) * 100 : 0
        },
        categories: categories.sort((a, b) => b.potentialProfit - a.potentialProfit),
        recommendations: this.generateCostOptimizationRecommendations(categories, overallMargin)
      };
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error calculating cost analysis');
    }
  }

  async getSupplierPerformance(dateRange) {
    try {
      // This would integrate with supplier data - for now using mock data
      const inventory = await Inventory.find().populate('product', 'name category supplier');
      
      const supplierData = new Map();
      
      for (const item of inventory) {
        if (!item.product) continue;
        
        const supplier = item.product.supplier || 'Unknown Supplier';
        
        if (!supplierData.has(supplier)) {
          supplierData.set(supplier, {
            supplier,
            totalProducts: 0,
            totalValue: 0,
            avgLeadTime: Math.floor(Math.random() * 14) + 3, // 3-17 days
            onTimeDeliveryRate: Math.floor(Math.random() * 20) + 80, // 80-100%
            qualityRating: Math.floor(Math.random() * 10) + 90, // 90-100%
            costEfficiency: Math.floor(Math.random() * 20) + 80, // 80-100%
            categories: new Set()
          });
        }
        
        const data = supplierData.get(supplier);
        data.totalProducts += 1;
        data.totalValue += item.quantity * (item.product.price || 0);
        data.categories.add(item.product.category);
      }
      
      const suppliers = Array.from(supplierData.values()).map(supplier => ({
        ...supplier,
        categories: Array.from(supplier.categories),
        performanceScore: Math.round(
          (supplier.onTimeDeliveryRate * 0.4 + 
           supplier.qualityRating * 0.3 + 
           supplier.costEfficiency * 0.3) / 100 * 100
        ) / 100,
        riskLevel: supplier.onTimeDeliveryRate < 85 || supplier.qualityRating < 90 ? 'high' : 
                  supplier.onTimeDeliveryRate < 95 || supplier.qualityRating < 95 ? 'medium' : 'low'
      }));
      
      return {
        suppliers: suppliers.sort((a, b) => b.performanceScore - a.performanceScore),
        summary: {
          totalSuppliers: suppliers.length,
          avgLeadTime: suppliers.reduce((sum, s) => sum + s.avgLeadTime, 0) / suppliers.length,
          avgOnTimeDelivery: suppliers.reduce((sum, s) => sum + s.onTimeDeliveryRate, 0) / suppliers.length,
          avgQualityRating: suppliers.reduce((sum, s) => sum + s.qualityRating, 0) / suppliers.length,
          highRiskSuppliers: suppliers.filter(s => s.riskLevel === 'high').length
        },
        recommendations: this.generateSupplierRecommendations(suppliers)
      };
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error calculating supplier performance');
    }
  }

  async getAdvancedMetrics(dateRange) {
    try {
      const { start, end } = dateRange;
      
      const inventory = await Inventory.find().populate('product', 'name price category');
      const orders = await Order.find({
        createdAt: { $gte: start, $lte: end },
        status: { $in: ['delivered', 'completed'] }
      });

      // Calculate ABC Analysis (80/20 rule)
      const productValues = inventory.map(item => ({
        product: item.product,
        value: item.quantity * (item.product?.price || 0),
        quantity: item.quantity
      })).sort((a, b) => b.value - a.value);

      const totalValue = productValues.reduce((sum, item) => sum + item.value, 0);
      let cumulativeValue = 0;
      const abcAnalysis = productValues.map((item, index) => {
        cumulativeValue += item.value;
        const cumulativePercentage = (cumulativeValue / totalValue) * 100;
        
        let category = 'C';
        if (cumulativePercentage <= 80) category = 'A';
        else if (cumulativePercentage <= 95) category = 'B';
        
        return {
          ...item,
          rank: index + 1,
          cumulativePercentage,
          abcCategory: category
        };
      });

      // Calculate inventory ratios
      const totalInventoryValue = inventory.reduce((sum, item) => 
        sum + item.quantity * (item.product?.price || 0), 0);
      
      const totalSales = orders.reduce((sum, order) => sum + order.totalAmount, 0);
      const cogs = totalSales * 0.7; // Assuming 70% COGS
      
      const inventoryTurnoverRatio = totalInventoryValue > 0 ? cogs / totalInventoryValue : 0;
      const daysInInventory = inventoryTurnoverRatio > 0 ? 365 / inventoryTurnoverRatio : 0;
      
      // Calculate fill rate
      const stockouts = inventory.filter(item => item.quantity === 0).length;
      const fillRate = inventory.length > 0 ? ((inventory.length - stockouts) / inventory.length) * 100 : 100;
      
      // Calculate inventory accuracy (simulated)
      const inventoryAccuracy = Math.random() * 5 + 95; // 95-100%
      
      return {
        abcAnalysis: {
          aCategory: abcAnalysis.filter(item => item.abcCategory === 'A'),
          bCategory: abcAnalysis.filter(item => item.abcCategory === 'B'),
          cCategory: abcAnalysis.filter(item => item.abcCategory === 'C')
        },
        keyMetrics: {
          inventoryTurnoverRatio: Math.round(inventoryTurnoverRatio * 100) / 100,
          daysInInventory: Math.round(daysInInventory),
          fillRate: Math.round(fillRate * 100) / 100,
          inventoryAccuracy: Math.round(inventoryAccuracy * 100) / 100,
          stockoutFrequency: stockouts,
          averageStockValue: totalInventoryValue / inventory.length
        },
        performance: {
          turnoverTrend: this.calculateTurnoverTrend(inventoryTurnoverRatio),
          efficiency: inventoryTurnoverRatio > 4 ? 'excellent' : inventoryTurnoverRatio > 2 ? 'good' : 'needs_improvement',
          recommendations: this.generateEfficiencyRecommendations(inventoryTurnoverRatio, fillRate, daysInInventory)
        }
      };
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error calculating advanced metrics');
    }
  }

  // Helper methods for new analytics
  calculateDemandTrend(orders) {
  if (!orders || orders.length < 2) return 0;

  const split = Math.floor(orders.length / 2) || 1;
  const older = orders.slice(0, split);
  const recent = orders.slice(split);

  // Use order counts as a lightweight proxy for demand trend
  const olderAvg = older.length;
  const recentAvg = recent.length;

  return olderAvg > 0 ? (recentAvg - olderAvg) / olderAvg : 0;
  }

  calculateSeasonalFactor(date) {
    const month = date.getMonth();
    // Simple seasonal factors - could be enhanced with historical data
    const seasonalFactors = [0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.1, 1.0, 0.9, 1.0, 1.4, 1.5]; // Jan-Dec
    return seasonalFactors[month];
  }

  calculateVariation(values) {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  getStockingRecommendations(seasonalData) {
    const peakMonths = seasonalData.filter(m => m.seasonalIndex > 1.2);
    return peakMonths.map(month => ({
      month: month.month,
      recommendation: `Increase stock by ${Math.round((month.seasonalIndex - 1) * 100)}% before ${month.month}`,
      expectedIncrease: month.seasonalIndex
    }));
  }

  generateCostOptimizationRecommendations(categories, overallMargin) {
    const recommendations = [];
    
    const lowMarginCategories = categories.filter(cat => cat.marginPercentage < 20);
    if (lowMarginCategories.length > 0) {
      recommendations.push({
        type: 'cost_optimization',
        priority: 'high',
        message: `Review pricing for ${lowMarginCategories.length} categories with margins below 20%`,
        categories: lowMarginCategories.map(cat => cat.category)
      });
    }
    
    const highValueCategories = categories.filter(cat => cat.inventoryValue > 10000);
    if (highValueCategories.length > 0) {
      recommendations.push({
        type: 'inventory_reduction',
        priority: 'medium',
        message: 'Consider reducing stock levels for high-value categories to free up capital',
        categories: highValueCategories.map(cat => cat.category)
      });
    }
    
    return recommendations;
  }

  generateSupplierRecommendations(suppliers) {
    const recommendations = [];
    
    const highRiskSuppliers = suppliers.filter(s => s.riskLevel === 'high');
    if (highRiskSuppliers.length > 0) {
      recommendations.push({
        type: 'supplier_risk',
        priority: 'high',
        message: `Review ${highRiskSuppliers.length} high-risk suppliers for performance issues`,
        suppliers: highRiskSuppliers.map(s => s.supplier)
      });
    }
    
    const slowSuppliers = suppliers.filter(s => s.avgLeadTime > 14);
    if (slowSuppliers.length > 0) {
      recommendations.push({
        type: 'lead_time',
        priority: 'medium',
        message: 'Consider alternative suppliers for faster delivery times',
        suppliers: slowSuppliers.map(s => s.supplier)
      });
    }
    
    return recommendations;
  }

  calculateTurnoverTrend(currentTurnover) {
    // Simulate historical comparison
    const historicalTurnover = Math.random() * 3 + 1;
    return currentTurnover > historicalTurnover ? 'improving' : 'declining';
  }

  generateEfficiencyRecommendations(turnover, fillRate, daysInInventory) {
    const recommendations = [];
    
    if (turnover < 2) {
      recommendations.push('Increase marketing efforts to move slow-moving inventory');
      recommendations.push('Consider promotional pricing for excess stock');
    }
    
    if (fillRate < 95) {
      recommendations.push('Improve demand forecasting to reduce stockouts');
      recommendations.push('Implement safety stock levels for critical items');
    }
    
    if (daysInInventory > 180) {
      recommendations.push('Optimize reorder points to reduce excess inventory');
      recommendations.push('Implement just-in-time purchasing for fast-moving items');
    }
    
    return recommendations;
  }
}

export const inventoryAnalyticsService = new InventoryAnalyticsService();
