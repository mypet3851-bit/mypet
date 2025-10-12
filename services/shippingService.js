import ShippingZone from '../models/ShippingZone.js';
import ShippingRate from '../models/ShippingRate.js';

/**
 * Calculate shipping fee based on order details
 * @param {Object} params - Shipping calculation parameters
 * @param {number} params.subtotal - Order subtotal
 * @param {number} params.weight - Total weight of items
 * @param {string} params.country - Destination country
 * @param {string} params.region - Destination region (optional)
 * @param {string} params.city - Destination city (optional for city-specific rates)
 * @returns {Promise<number>} Calculated shipping fee
 */
export const calculateShippingFee = async ({ subtotal, weight, country, region, city }) => {
  try {
    // City-first lookup: treat `countries` array as list of cities if no real country logic is used
    let zones = [];
    if (city) {
      zones = await ShippingZone.find({ countries: { $in: [city] }, isActive: true });
    }
    // If none by city, fall back to country / region (for future extensibility)
    if (zones.length === 0 && country) {
      zones = await ShippingZone.findByCountry(country);
    }
    if (zones.length === 0 && region) {
      zones = await ShippingZone.findByRegion(region);
    }
    if (zones.length === 0) {
      throw new Error('No shipping zones found for the specified location');
    }
    
    const zoneIds = zones.map(z => z._id);
    // Get all shipping rates for the matching zones
    const allRates = [];
    for (const zone of zones) {
      const rates = await ShippingRate.findByZone(zone._id);
      allRates.push(...rates);
    }

    // If city provided, attempt to find city-specific overrides
    let citySpecific = [];
    if (city) {
      if (typeof ShippingRate.findByCity === 'function') {
        citySpecific = await ShippingRate.findByCity(city, zoneIds);
      } else if (zoneIds.length) {
        // Fallback manual query replicating findByCity logic
        const regex = new RegExp(`^${city}$`, 'i');
        citySpecific = await ShippingRate.find({
          zone: { $in: zoneIds },
          isActive: true,
          cities: { $elemMatch: { name: regex } }
        }).populate('zone');
      } else {
        const regex = new RegExp(`^${city}$`, 'i');
        citySpecific = await ShippingRate.find({
          isActive: true,
          cities: { $elemMatch: { name: regex } }
        }).populate('zone');
      }
    }
    
    if (allRates.length === 0) {
      throw new Error('No shipping rates found for the specified location');
    }
    
    // Calculate costs for all applicable rates
    const applicableRates = [];
    
    const candidateRates = citySpecific.length ? citySpecific : allRates;
    for (const rate of candidateRates) {
      const cost = rate.calculateCost(subtotal, weight);
      if (cost !== null) {
        applicableRates.push({
          rate,
          cost: resolveCityCost(rate, cost, city),
          method: rate.method,
          name: rate.name
        });
      }
    }
    
    if (applicableRates.length === 0) {
      throw new Error('No applicable shipping rates found for the order criteria');
    }
    
    // Sort by cost (cheapest first) and return the lowest cost
    applicableRates.sort((a, b) => a.cost - b.cost);
    
    return applicableRates[0].cost;
  } catch (error) {
    console.error('Error calculating shipping fee:', error);
    throw new Error(`Failed to calculate shipping fee: ${error.message}`);
  }
};

/**
 * Get available shipping options for a location
 * @param {Object} params - Location parameters
 * @param {string} params.country - Destination country
 * @param {string} params.region - Destination region (optional)
 * @param {number} params.subtotal - Order subtotal (optional)
 * @param {number} params.weight - Total weight (optional)
 * @returns {Promise<Array>} Available shipping options
 */
export const getAvailableShippingOptions = async ({ country, region, city, subtotal = 0, weight = 0 }) => {
  try {
    // City-first strategy (we repurpose `countries` to store city names)
    let zones = [];
    if (city) {
      zones = await ShippingZone.find({ countries: { $in: [city] }, isActive: true });
    }
    if (zones.length === 0 && country) {
      zones = await ShippingZone.findByCountry(country);
    }
    if (zones.length === 0 && region) {
      zones = await ShippingZone.findByRegion(region);
    }
    if (zones.length === 0) {
      return [];
    }
    
    const zoneIds = zones.map(z => z._id);
    // Get all shipping rates for the matching zones
    const allRates = [];
    for (const zone of zones) {
      const rates = await ShippingRate.findByZone(zone._id);
      allRates.push(...rates);
    }

    // City-specific overrides
    let citySpecific = [];
    if (city) {
      if (typeof ShippingRate.findByCity === 'function') {
        citySpecific = await ShippingRate.findByCity(city, zoneIds);
      } else if (zoneIds.length) {
        const regex = new RegExp(`^${city}$`, 'i');
        citySpecific = await ShippingRate.find({
          zone: { $in: zoneIds },
          isActive: true,
          cities: { $elemMatch: { name: regex } }
        }).populate('zone');
      } else {
        const regex = new RegExp(`^${city}$`, 'i');
        citySpecific = await ShippingRate.find({
          isActive: true,
          cities: { $elemMatch: { name: regex } }
        }).populate('zone');
      }
    }
    
    // Calculate costs for all applicable rates
    const options = [];
    
    const candidateRates = citySpecific.length ? citySpecific : allRates;
    for (const rate of candidateRates) {
      const cost = rate.calculateCost(subtotal, weight);
      if (cost !== null) {
        options.push({
          id: rate._id,
          name: rate.name,
          description: rate.description,
          method: rate.method,
          cost: resolveCityCost(rate, cost, city),
          zone: rate.zone.name,
          estimatedDays: rate.estimatedDays || null
        });
      }
    }

    // Fallback: if a zone defines a uniform zonePrice include it (if not already represented by cheaper/equal rate)
    for (const zone of zones) {
      if (typeof zone.zonePrice === 'number' && zone.zonePrice >= 0) {
        // If no existing option belongs to this zone with same or lower cost, add it
        const hasEquivalent = options.some(o => o.zone === zone.name && o.cost <= zone.zonePrice);
        if (!hasEquivalent) {
          options.push({
            id: `zonePrice:${zone._id}`,
            name: `${zone.name} Standard`,
            description: 'Zone base shipping',
            method: 'zone_price',
            cost: zone.zonePrice,
            zone: zone.name,
            estimatedDays: null
          });
        }
      }
    }
    
    // Sort by cost (cheapest first)
    options.sort((a, b) => a.cost - b.cost);
    
    return options;
  } catch (error) {
    console.error('Error getting shipping options:', error);
    throw new Error(`Failed to get shipping options: ${error.message}`);
  }
};

// Helper to override cost if city entry exists with specific cost
function resolveCityCost(rate, baseCost, city) {
  if (!city || !rate.cities || !rate.cities.length) return baseCost;
  const match = rate.cities.find(c => c.name && city && c.name.toLowerCase() === city.toLowerCase());
  if (match && typeof match.cost === 'number') {
    return match.cost;
  }
  return baseCost;
}

/**
 * Validate shipping address
 * @param {Object} address - Shipping address
 * @param {string} address.country - Country
 * @param {string} address.region - State/Province/Region
 * @param {string} address.city - City
 * @param {string} address.postalCode - Postal/ZIP code
 * @returns {Promise<boolean>} Whether address is valid for shipping
 */
export const validateShippingAddress = async (address) => {
  try {
    const { country, region } = address;
    
    if (!country) {
      return false;
    }
    
    // Check if we have shipping zones for this location
    let zones = await ShippingZone.findByCountry(country);
    
    if (zones.length === 0 && region) {
      zones = await ShippingZone.findByRegion(region);
    }
    
    return zones.length > 0;
  } catch (error) {
    console.error('Error validating shipping address:', error);
    return false;
  }
};

/**
 * Create default shipping zones and rates
 * This function can be used for initial setup
 */
export const createDefaultShippingData = async () => {
  try {
    // Check if zones already exist
    const existingZones = await ShippingZone.find();
    if (existingZones.length > 0) {
      console.log('Shipping zones already exist, skipping default creation');
      return;
    }
    
    // Create default zones
    const domesticZone = new ShippingZone({
      name: 'Domestic',
      description: 'Local shipping within the country',
      countries: ['US'], // Adjust based on your primary country
      isActive: true,
      order: 1
    });
    
    const internationalZone = new ShippingZone({
      name: 'International',
      description: 'International shipping',
      countries: ['CA', 'MX', 'GB', 'FR', 'DE', 'AU', 'JP'], // Add more as needed
      isActive: true,
      order: 2
    });
    
    await domesticZone.save();
    await internationalZone.save();
    
    // Create default rates
    const domesticStandard = new ShippingRate({
      zone: domesticZone._id,
      name: 'Standard Shipping',
      description: 'Standard domestic shipping (5-7 business days)',
      method: 'flat_rate',
      cost: 9.99,
      conditions: {
        minOrderValue: 0
      },
      isActive: true,
      order: 1
    });
    
    const domesticExpress = new ShippingRate({
      zone: domesticZone._id,
      name: 'Express Shipping',
      description: 'Express domestic shipping (2-3 business days)',
      method: 'flat_rate',
      cost: 19.99,
      conditions: {
        minOrderValue: 0
      },
      isActive: true,
      order: 2
    });
    
    const domesticFree = new ShippingRate({
      zone: domesticZone._id,
      name: 'Free Shipping',
      description: 'Free shipping on orders over $50',
      method: 'free',
      cost: 0,
      conditions: {
        minOrderValue: 50
      },
      isActive: true,
      order: 0
    });
    
    const internationalStandard = new ShippingRate({
      zone: internationalZone._id,
      name: 'International Standard',
      description: 'Standard international shipping (10-15 business days)',
      method: 'flat_rate',
      cost: 24.99,
      conditions: {
        minOrderValue: 0
      },
      isActive: true,
      order: 1
    });
    
    await domesticStandard.save();
    await domesticExpress.save();
    await domesticFree.save();
    await internationalStandard.save();
    
    console.log('Default shipping zones and rates created successfully');
  } catch (error) {
    console.error('Error creating default shipping data:', error);
    throw error;
  }
};
